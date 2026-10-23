import { NextResponse } from "next/server";
import { auth } from "./auth";
import { prisma } from "./prisma";
import {
  FailureLimiter,
  clientAddress,
  isSealedLogin,
  openSealedLogin,
  sealLogin,
  isPrivateAddress,
  parsePlayerKeySecret,
  playerKeySecret,
  signLink,
  verifyLink,
  type LinkScope,
} from "./link-security";
import { playlistLogins, type Login } from "./playlist-login";

/**
 * Who may open a stream, guide or image link:
 *  1. a signed-in browser (session cookie), or
 *  2. a valid short-lived signed link (`t=`), or
 *  3. a device key that has not been revoked (`k=`), or
 *  4. a playlist login (the same one ESPG uses): `username=` + `password=`,
 *     HTTP Basic, or the sealed form we put in links we hand out (`k=pl1.…`), or
 *  5. a device on the home network, while "home network without a key" is on.
 * Anything else counts as a failed check; too many from one address → 429.
 */

export const IMAGE_PASS_TTL_SECONDS = 7 * 24 * 3600;
export const DEFAULT_KEY_NAME = "Home network";

const limiter = new FailureLimiter(
  Number(process.env.LINK_FAILURE_LIMIT) || 20,
  10 * 60_000,
  10 * 60_000,
);

let settingsCache: { at: number; allowLan: boolean } | null = null;
async function allowLanWithoutKey(): Promise<boolean> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < 10_000) return settingsCache.allowLan;
  const row = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { allowLanWithoutKey: true } });
  settingsCache = { at: now, allowLan: row?.allowLanWithoutKey ?? true };
  return settingsCache.allowLan;
}
export function clearPlayerAccessCache() {
  settingsCache = null;
  keyCache.clear();
}

const keyCache = new Map<string, { at: number; valid: boolean }>();
const lastUsedWrite = new Map<string, number>();

async function keyIsActive(id: string): Promise<boolean> {
  const now = Date.now();
  const hit = keyCache.get(id);
  if (hit && now - hit.at < 5_000) return hit.valid;
  const row = await prisma.playerKey.findUnique({ where: { id }, select: { revokedAt: true } });
  const valid = !!row && !row.revokedAt;
  keyCache.set(id, { at: now, valid });
  if (valid && now - (lastUsedWrite.get(id) ?? 0) > 60_000) {
    lastUsedWrite.set(id, now);
    prisma.playerKey.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return valid;
}

export type PlayerAuth = {
  via: "session" | "token" | "key" | "lan" | "login";
  /** Key id for links we hand back to this client (M3U, lineup). */
  keyId: string | null;
  userId: string | null;
  /** Playlist login; links we hand back carry it sealed. */
  login?: Login;
};

function basicLogin(headers: Headers): Login | null {
  const h = headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("basic ")) return null;
  try {
    const text = Buffer.from(h.slice(6).trim(), "base64").toString("utf8");
    const i = text.indexOf(":");
    return i > 0 ? { username: text.slice(0, i), password: text.slice(i + 1) } : null;
  } catch {
    return null;
  }
}

function loginFromRequest(request: Req): Login | null {
  const p = request.nextUrl.searchParams;
  const username = p.get("username");
  const password = p.get("password");
  if (username && password) return { username: username.trim(), password: password.trim() };
  const k = p.get("k");
  if (isSealedLogin(k)) return openSealedLogin(k) ?? { username: "", password: "" };
  return basicLogin(request.headers);
}

type Req = { headers: Headers; nextUrl: URL };

export async function authorizePlayer(
  request: Req,
  check: { scope: LinkScope; resource: string; allowLan?: boolean },
): Promise<{ ok: true; auth: PlayerAuth } | { ok: false; response: NextResponse }> {
  const ip = clientAddress(request.headers);
  if (limiter.isBlocked(ip)) {
    return { ok: false, response: new NextResponse("Too many bad links. Try again later.", { status: 429, headers: { "Retry-After": "600" } }) };
  }
  const params = request.nextUrl.searchParams;
  const t = params.get("t");
  const k = params.get("k");
  const login = loginFromRequest(request);

  if (t) {
    const res = verifyLink(t, check.scope, check.resource);
    if (res.ok) {
      // Tokens issued to a device die with that device's key.
      if (!res.sub.startsWith("key:") || (await keyIsActive(res.sub.slice(4)))) {
        return { ok: true, auth: { via: "token", keyId: res.sub.startsWith("key:") ? res.sub.slice(4) : null, userId: res.sub.startsWith("user:") ? res.sub.slice(5) : null } };
      }
    }
  }
  if (login) {
    const res = await playlistLogins.check(login);
    if (res.ok) {
      return { ok: true, auth: { via: "login", keyId: null, userId: res.userId, login } };
    }
    if (res.reason === "unavailable") {
      // ESPG is down and this login is not cached: not the viewer's fault.
      return {
        ok: false,
        response: new NextResponse("Can't check your playlist login right now. Try again in a minute.", {
          status: 503,
          headers: { "Retry-After": "30", "Cache-Control": "no-store" },
        }),
      };
    }
    limiter.recordFailure(ip);
    if (res.reason === "no-access") {
      return {
        ok: false,
        response: new NextResponse(
          "This playlist login works in ESPG, but that person isn't a TwentyFourSeven user yet. Sign in to TwentyFourSeven once with WatchTower, then try again.",
          { status: 403, headers: { "Cache-Control": "no-store" } },
        ),
      };
    }
    return {
      ok: false,
      response: new NextResponse("Wrong playlist username or password.", {
        status: 401,
        headers: { "Cache-Control": "no-store", "WWW-Authenticate": 'Basic realm="TwentyFourSeven"' },
      }),
    };
  }
  if (k && !isSealedLogin(k)) {
    const id = parsePlayerKeySecret(k);
    if (id && (await keyIsActive(id))) {
      return { ok: true, auth: { via: "key", keyId: id, userId: null } };
    }
  }
  if (request.headers.get("cookie")) {
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user?.id) {
        return { ok: true, auth: { via: "session", keyId: null, userId: session.user.id } };
      }
    } catch {
      // fall through
    }
  }
  if (!t && !k && !login && check.allowLan !== false && isPrivateAddress(ip) && (await allowLanWithoutKey())) {
    return { ok: true, auth: { via: "lan", keyId: null, userId: null } };
  }
  limiter.recordFailure(ip);
  const status = t || k ? 403 : 401;
  return {
    ok: false,
    response: new NextResponse(
      status === 403 ? "This link has expired or was turned off. Get a new link in TwentyFourSeven Settings." : "A player link with a key is required.",
      { status, headers: { "Cache-Control": "no-store" } },
    ),
  };
}

/**
 * `k` (and the image pass) for links we hand back to this client. Playlist
 * logins get their login sealed into `k`, so each later request is checked
 * again (and access removed in ESPG stops it) without a password in the URL.
 */
export async function linkParamsFor(a: PlayerAuth) {
  if (a.via === "login" && a.login) {
    return {
      k: sealLogin(a.login),
      imagePass: signLink("image", "*", `login:${a.login.username}`, 24 * 3600),
    };
  }
  return linkParamsForKey(await keyForLinks(a));
}

/** The key whose secret goes into links we generate for this client. */
export async function keyForLinks(a: PlayerAuth): Promise<string> {
  if (a.keyId) return a.keyId;
  const existing = await prisma.playerKey.findFirst({ where: { name: DEFAULT_KEY_NAME, revokedAt: null }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  return (await prisma.playerKey.create({ data: { name: DEFAULT_KEY_NAME } })).id;
}

export function linkParamsForKey(keyId: string) {
  return {
    k: playerKeySecret(keyId),
    imagePass: signLink("image", "*", `key:${keyId}`, IMAGE_PASS_TTL_SECONDS),
  };
}
