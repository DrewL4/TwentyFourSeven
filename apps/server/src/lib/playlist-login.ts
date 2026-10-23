import { createHmac, randomBytes } from "node:crypto";
import { openSealedLogin, sealLogin } from "./link-security";

/**
 * Playlist logins for TV apps: the same username/password people already use
 * for ESPG. TwentyFourSeven never copies ESPG's rules; it asks ESPG
 * (server to server, with TwentyFourSeven's WatchTower app token) and caches
 * "yes" answers for a few minutes, so a short ESPG restart does not stop
 * playback and removed access takes effect within that window.
 *
 * Without ESPG, each user gets a TwentyFourSeven playlist login instead.
 * Passwords are never logged.
 */

export type Login = { username: string; password: string };
export type LoginCheck =
  | { ok: true; source: "espg" | "tfs"; email: string | null; userId: string | null; playlist?: string }
  | { ok: false; reason: "wrong" | "unavailable" | "no-access" };

export type EspgLink = { url: string; token: string };

type Deps = {
  espg(): Promise<EspgLink | null>;
  fetch: typeof fetch;
  findLocal(username: string): Promise<{ userId: string; passwordSealed: string } | null>;
  userIdByEmail(email: string): Promise<string | null>;
  now(): number;
};

export const LOGIN_CACHE_MS = (Number(process.env.PLAYLIST_LOGIN_CACHE_SECONDS) || 300) * 1000;

const cache = new Map<string, { at: number; result: Extract<LoginCheck, { ok: true }> }>();

function cacheKey(login: Login): string {
  // Keyed by a keyed hash, so the cache never holds a password.
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET || "tfs").update(`${login.username}\0${login.password}`).digest("base64url");
}

export function clearLoginCache() {
  cache.clear();
}

async function askEspg(link: EspgLink, body: Record<string, unknown>, f: typeof fetch): Promise<any> {
  const res = await f(`${link.url.replace(/\/+$/, "")}/api/v1/users/integrations/tfs/playlist-login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`ESPG answered HTTP ${res.status}`);
  return res.json();
}

export function createLoginChecker(deps: Deps) {
  async function check(login: Login): Promise<LoginCheck> {
    if (!login.username || !login.password || login.username.length > 200 || login.password.length > 200) {
      return { ok: false, reason: "wrong" };
    }
    const key = cacheKey(login);
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < LOGIN_CACHE_MS) return hit.result;

    let result: LoginCheck;
    const espg = await deps.espg();
    if (espg) {
      try {
        const data = await askEspg(espg, { action: "verify", username: login.username, password: login.password }, deps.fetch);
        if (data?.valid) {
          const email = typeof data.user?.email === "string" ? data.user.email : null;
          const userId = email ? await deps.userIdByEmail(email) : null;
          // ESPG access is not TwentyFourSeven access: the person must also be a
          // TwentyFourSeven user (WatchTower lets them in on their first sign-in).
          result = userId
            ? {
                ok: true,
                source: "espg",
                email,
                userId,
                playlist: typeof data.playlist === "string" ? data.playlist : undefined,
              }
            : { ok: false, reason: "no-access" };
        } else {
          result = { ok: false, reason: "wrong" };
        }
      } catch (error) {
        console.warn("[playlist-login] ESPG check failed:", error instanceof Error ? error.message : "error");
        return { ok: false, reason: "unavailable" };
      }
    } else {
      const row = await deps.findLocal(login.username);
      const stored = row ? openSealedLogin(row.passwordSealed) : null;
      result =
        row && stored && stored.username === login.username && stored.password === login.password
          ? { ok: true, source: "tfs", email: null, userId: row.userId }
          : { ok: false, reason: "wrong" };
    }

    if (result.ok) {
      cache.set(key, { at: deps.now(), result });
      if (cache.size > 2000) {
        for (const [k, v] of cache) if (deps.now() - v.at >= LOGIN_CACHE_MS) cache.delete(k);
      }
    } else {
      cache.delete(key);
    }
    return result;
  }

  async function lookup(email: string): Promise<{ source: "espg"; logins: Array<Login & { playlist: string }> } | null> {
    const espg = await deps.espg();
    if (!espg) return null;
    const data = await askEspg(espg, { action: "lookup", email }, deps.fetch);
    const rows = Array.isArray(data?.logins) ? data.logins : [];
    return {
      source: "espg",
      logins: rows
        .filter((r: any) => typeof r?.username === "string" && typeof r?.password === "string")
        .map((r: any) => ({ playlist: String(r.playlist ?? ""), username: r.username, password: r.password })),
    };
  }

  return { check, lookup };
}

/** A new TwentyFourSeven playlist login (standalone mode). */
export function newLocalLogin(name: string): Login & { passwordSealed: string } {
  const base = (name || "viewer").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "viewer";
  const username = `tfs${base}${randomBytes(2).toString("hex")}`;
  const password = randomBytes(9).toString("base64url");
  return { username, password, passwordSealed: sealLogin({ username, password }) };
}

// --- app wiring -------------------------------------------------------------

let espgCache: { at: number; value: EspgLink | null } | null = null;

export function clearEspgLinkCache() {
  espgCache = null;
}

async function espgFromSettings(): Promise<EspgLink | null> {
  const now = Date.now();
  if (espgCache && now - espgCache.at < 15_000) return espgCache.value;
  const { prisma } = await import("./prisma");
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { espgUrl: true } });
  const url = (settings?.espgUrl || process.env.ESPG_URL || "").trim();
  let value: EspgLink | null = null;
  if (url) {
    const row = await prisma.setting.findUnique({ where: { key: "watchtower_api_token" } });
    if (row?.value) value = { url, token: row.value };
  }
  espgCache = { at: now, value };
  return value;
}

/** Is ESPG set up (address + WatchTower app token)? */
export async function espgConfigured(): Promise<{ url: string; hasToken: boolean } | null> {
  const { prisma } = await import("./prisma");
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { espgUrl: true } });
  const url = (settings?.espgUrl || process.env.ESPG_URL || "").trim();
  if (!url) return null;
  const row = await prisma.setting.findUnique({ where: { key: "watchtower_api_token" } });
  return { url, hasToken: !!row?.value };
}

export const playlistLogins = createLoginChecker({
  espg: espgFromSettings,
  fetch: (...args) => fetch(...args),
  findLocal: async (username) => {
    const { prisma } = await import("./prisma");
    return prisma.playlistLogin.findUnique({ where: { username }, select: { userId: true, passwordSealed: true } });
  },
  userIdByEmail: async (email) => {
    const { prisma } = await import("./prisma");
    const user =
      (await prisma.user.findFirst({ where: { email }, select: { id: true } })) ??
      (await prisma.user.findFirst({ where: { email: email.toLowerCase() }, select: { id: true } }));
    return user?.id ?? null;
  },
  now: () => Date.now(),
});
