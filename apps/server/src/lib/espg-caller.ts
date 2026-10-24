import { createHash } from "node:crypto";

/**
 * Is this request from ESPG? ESPG sends its WatchTower app token; we ask
 * WatchTower whether it is an active token for the "espg" app (the same
 * check ESPG does for TwentyFourSeven's token). Yes/no answers are cached
 * for 60 s by a hash of the token, never the token itself.
 */

type Deps = {
  watchTowerUrl(): Promise<string | null>;
  fetch: typeof fetch;
  now(): number;
};

const CACHE_MS = 60_000;
// Keyed by whatever bearer token a caller sends, so it has to stay bounded.
const CACHE_MAX = 1000;
const cache = new Map<string, { at: number; ok: boolean }>();

function remember(key: string, ok: boolean, now: number) {
  cache.delete(key);
  cache.set(key, { at: now, ok });
  if (cache.size <= CACHE_MAX) return;
  for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  // Still full of fresh entries: drop the oldest (Map keeps insertion order).
  for (const k of cache.keys()) {
    if (cache.size <= CACHE_MAX) break;
    cache.delete(k);
  }
}

export function clearEspgCallerCache() {
  cache.clear();
}

export function bearer(headers: Headers): string | null {
  const h = headers.get("authorization") || "";
  const m = /^(Bearer|Token)\s+(.+)$/i.exec(h.trim());
  return m ? m[2].trim() : null;
}

export function createEspgCallerCheck(deps: Deps) {
  return async function isEspg(token: string | null): Promise<boolean> {
    if (!token || token.length > 500) return false;
    const key = createHash("sha256").update(token).digest("base64url");
    const hit = cache.get(key);
    if (hit && deps.now() - hit.at < CACHE_MS) return hit.ok;
    const wt = (await deps.watchTowerUrl())?.replace(/\/+$/, "");
    if (!wt) return false;
    let ok = false;
    try {
      const res = await deps.fetch(`${wt}/api/api/v1/auth/validate-api-token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data: any = await res.json().catch(() => null);
        ok = data?.valid !== false && String(data?.app_name || "").toLowerCase() === "espg";
      }
    } catch {
      return false; // not cached: WatchTower may be back in a moment
    }
    remember(key, ok, deps.now());
    return ok;
  };
}

export const isEspgCaller = createEspgCallerCheck({
  watchTowerUrl: async () => {
    const { prisma } = await import("./prisma");
    const row = await prisma.setting.findUnique({ where: { key: "watchtower_url" } });
    return row?.value || process.env.WATCHTOWER_URL || null;
  },
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
});
