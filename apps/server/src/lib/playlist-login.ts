import { createHmac, randomBytes } from "node:crypto";
import { openSealedLogin, sealLogin } from "./link-security";

/**
 * Playlist logins for TV apps (Xtream Codes, M3U, XMLTV, HDHomeRun).
 *
 * Two modes, chosen by the admin (Settings.playlistLoginMode):
 *  - "tfs"  (on its own): TwentyFourSeven keeps one login per user. New and
 *    reset logins follow ESPG's default rule exactly (see defaultLogin).
 *  - "espg" (linked): logins come from ESPG and are edited there. TwentyFourSeven
 *    asks ESPG (server to server, with its WatchTower app token) and caches
 *    "yes" answers for about a minute. Linked without a token is an error,
 *    never a silent switch to local logins.
 *
 * Passwords are never logged.
 */

export type Login = { username: string; password: string };
export type LoginCheck =
  | { ok: true; source: "espg" | "tfs"; email: string | null; userId: string | null; playlist?: string }
  | { ok: false; reason: "wrong" | "unavailable" | "no-access" };

export type EspgLink = { url: string; token: string };
export type LoginMode = "tfs" | "espg";
/** What the checker needs to know: on its own, or linked (with the link, or null when the token is missing). */
export type ModeState = { mode: "tfs" } | { mode: "espg"; link: EspgLink | null; url: string };

type Deps = {
  mode(): Promise<ModeState>;
  fetch: typeof fetch;
  findLocal(username: string): Promise<{ userId: string; passwordSealed: string } | null>;
  userIdByEmail(email: string): Promise<string | null>;
  now(): number;
};

/** "Yes" answers are remembered this long. ESPG also tells us when a login changes. */
export const LOGIN_CACHE_MS = (Number(process.env.PLAYLIST_LOGIN_CACHE_SECONDS) || 60) * 1000;

const cache = new Map<string, { at: number; result: Extract<LoginCheck, { ok: true }> }>();

function cacheKey(login: Login): string {
  // Keyed by a keyed hash, so the cache never holds a password.
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET || "tfs").update(`${login.username}\0${login.password}`).digest("base64url");
}

export function clearLoginCache() {
  cache.clear();
}

/**
 * The mode to use. An explicit choice wins. Before anyone chose (upgrades),
 * keep what the server did before: an ESPG address meant "linked".
 */
export function resolveMode(saved: string | null | undefined, espgUrl: string): LoginMode {
  if (saved === "tfs" || saved === "espg") return saved;
  return espgUrl.trim() ? "espg" : "tfs";
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

export class LinkedWithoutTokenError extends Error {
  constructor() {
    super("Playlist logins are linked to ESPG, but TwentyFourSeven isn't connected to WatchTower yet, so it can't ask ESPG. Connect WatchTower, or switch playlist logins to “On its own”.");
  }
}
export class LinkedWithoutAddressError extends Error {
  constructor() {
    super("Playlist logins are linked to ESPG, but no ESPG address is saved. Add the ESPG address, or switch playlist logins to “On its own”.");
  }
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
    const state = await deps.mode();
    if (state.mode === "espg") {
      if (!state.link) {
        console.warn("[playlist-login] linked to ESPG but the ESPG address or WatchTower token is missing; refusing logins");
        return { ok: false, reason: "unavailable" };
      }
      try {
        const data = await askEspg(state.link, { action: "verify", username: login.username, password: login.password }, deps.fetch);
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

  /** The ESPG logins of one person (linked mode). null = on its own. Throws when linked but not usable. */
  async function lookup(email: string): Promise<{ source: "espg"; logins: Array<Login & { playlist: string }> } | null> {
    const state = await deps.mode();
    if (state.mode !== "espg") return null;
    if (!state.link) throw state.url ? new LinkedWithoutTokenError() : new LinkedWithoutAddressError();
    const data = await askEspg(state.link, { action: "lookup", email }, deps.fetch);
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

// --- default login: a faithful port of ESPG's rule ---------------------------
//
// ESPG backend/apps/users/models.py UserPlaylist.save():
//   username = re.sub(r'[^\w]', '', playlist.name.lower()) + first_name.strip().lower()
//              (first name falls back to the e-mail part before @, lowercased)
//   taken?   -> add the last name one letter at a time (or the e-mail part),
//               then 2, 3, ...
//   password = last_name.strip().lower() or "password"
// Only the playlist name is cleaned; the first name keeps inner spaces, like ESPG.

export type NameSource = { firstName?: string | null; lastName?: string | null; email?: string | null };

/** Python 3 `re.sub(r'[^\w]', '', s)`: keep Unicode letters, digits and "_". */
export function playlistSlug(playlistName: string): string {
  return (playlistName || "").toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
}

function emailPart(email?: string | null): string {
  return email && email.includes("@") ? email.split("@")[0].toLowerCase() : (email || "").toLowerCase();
}

/**
 * ESPG's default playlist login for a person. `isTaken(username)` says whether
 * another login already uses a username (ESPG checks this exactly).
 */
export async function defaultLogin(
  user: NameSource,
  playlistName: string,
  isTaken: (username: string) => boolean | Promise<boolean>,
): Promise<Login> {
  const slug = playlistSlug(playlistName);
  let first = (user.firstName || "").trim().toLowerCase();
  if (!first && user.email) first = emailPart(user.email);
  // ESPG leaves the username empty when both are empty; we always have an e-mail.
  const base = slug || first ? `${slug}${first}` : "viewer";
  let candidate = base;
  if (await isTaken(candidate)) {
    const suffixSource = (user.lastName || "").trim().toLowerCase() || (user.email ? emailPart(user.email) : "");
    let used = false;
    for (let k = 1; k <= [...suffixSource].length; k++) {
      candidate = `${base}${[...suffixSource].slice(0, k).join("")}`;
      if (!(await isTaken(candidate))) {
        used = true;
        break;
      }
    }
    if (!used) {
      let n = 2;
      candidate = `${base}${n}`;
      while (await isTaken(candidate)) {
        n += 1;
        candidate = `${base}${n}`;
      }
    }
  }
  const password = (user.lastName || "").trim().toLowerCase() || "password";
  return { username: candidate, password };
}

/** Seal a login for storage. */
export function sealed(login: Login): Login & { passwordSealed: string } {
  return { ...login, passwordSealed: sealLogin(login) };
}

/** Old (pre-ESPG-rule) TwentyFourSeven login. Kept for tests and for reference; new logins use defaultLogin. */
export function newLocalLogin(name: string): Login & { passwordSealed: string } {
  const base = (name || "viewer").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "viewer";
  const username = `tfs${base}${randomBytes(2).toString("hex")}`;
  const password = randomBytes(9).toString("base64url");
  return { username, password, passwordSealed: sealLogin({ username, password }) };
}

// --- app wiring -------------------------------------------------------------

let modeCache: { at: number; value: ModeState } | null = null;

export function clearEspgLinkCache() {
  modeCache = null;
}

/** Saved mode + ESPG address, straight from the database. */
export async function loginSettings(): Promise<{ mode: LoginMode; savedMode: string; espgUrl: string; fromEnv: boolean; playlistName: string; hasToken: boolean }> {
  const { prisma } = await import("./prisma");
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: { espgUrl: true, playlistLoginMode: true, playlistName: true },
  });
  const espgUrl = (settings?.espgUrl || process.env.ESPG_URL || "").trim();
  const row = await prisma.setting.findUnique({ where: { key: "watchtower_api_token" } });
  return {
    mode: resolveMode(settings?.playlistLoginMode, espgUrl),
    savedMode: settings?.playlistLoginMode ?? "",
    espgUrl,
    fromEnv: !settings?.espgUrl && !!process.env.ESPG_URL,
    playlistName: settings?.playlistName ?? "247",
    hasToken: !!row?.value,
  };
}

async function modeFromSettings(): Promise<ModeState> {
  const now = Date.now();
  if (modeCache && now - modeCache.at < 15_000) return modeCache.value;
  const s = await loginSettings();
  let value: ModeState = { mode: "tfs" };
  if (s.mode === "espg") {
    let link: EspgLink | null = null;
    if (s.espgUrl && s.hasToken) {
      const { prisma } = await import("./prisma");
      const row = await prisma.setting.findUnique({ where: { key: "watchtower_api_token" } });
      if (row?.value) link = { url: s.espgUrl, token: row.value };
    }
    value = { mode: "espg", link, url: s.espgUrl };
  }
  modeCache = { at: now, value };
  return value;
}

/** Linked to ESPG? Returns the address and whether the token is there; null when on its own. */
export async function espgConfigured(): Promise<{ url: string; hasToken: boolean } | null> {
  const s = await loginSettings();
  if (s.mode !== "espg") return null;
  return { url: s.espgUrl, hasToken: s.hasToken };
}

/** Make (or rebuild) a user's default login in standalone mode. Never touches another user's row. */
export async function makeDefaultLoginFor(userId: string): Promise<Login> {
  const { prisma } = await import("./prisma");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true, name: true } });
  if (!user) throw new Error("No such user");
  const { playlistName } = await loginSettings();
  const login = await defaultLogin(
    { firstName: user.firstName, lastName: user.lastName, email: user.email },
    playlistName,
    async (u) => !!(await prisma.playlistLogin.findFirst({ where: { username: u, NOT: { userId } }, select: { id: true } })),
  );
  const s = sealed(login);
  await prisma.playlistLogin.upsert({
    where: { userId },
    create: { userId, username: s.username, passwordSealed: s.passwordSealed, custom: false, origin: "default" },
    update: { username: s.username, passwordSealed: s.passwordSealed, custom: false, origin: "default" },
  });
  clearLoginCache();
  return login;
}

export const playlistLogins = createLoginChecker({
  mode: modeFromSettings,
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
