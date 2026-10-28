/**
 * A page that stays open across a deploy keeps running the old JavaScript: the
 * fixes in the new build never reach it until it reloads. Every Next.js export
 * carries its build id in the page data (`"b":"<id>"`). The page asks the server
 * for its own HTML again and compares that id with the one it started with.
 * (Chunk file lists are not used: a page loads chunks late, and the webpack
 * runtime file keeps its name between builds.)
 */

const BUILD_ID = /\\?"b\\?":\\?"([\w-]+)\\?"/;

/** The build id inside page HTML (escaped quotes) or inside the page's own data (plain quotes). */
export function buildIdFrom(text: string): string | null {
  return BUILD_ID.exec(text)?.[1] ?? null;
}

/** True only when both ids are known and differ: an error page or empty reply is not a new build. */
export function bundleIsStale(runningId: string | null, freshId: string | null): boolean {
  return !!runningId && !!freshId && runningId !== freshId;
}

/** Reload at most once a minute, so a server that keeps serving odd HTML cannot loop. */
export function mayReload(lastReloadAt: number | null, now: number, minGapMs = 60_000): boolean {
  return lastReloadAt === null || now - lastReloadAt >= minGapMs;
}
