/**
 * A page that stays open across a deploy keeps running the old JavaScript: the
 * fixes in the new build never reach it until it reloads. The page asks the
 * server for its own HTML again and compares the script files that HTML names
 * with the ones this page loaded. A file the page does not have means a new build.
 */

const SCRIPT_SRC = /<script\b[^>]*\bsrc="([^"]*\/_next\/static\/[^"]+\.js(?:\?[^"]*)?)"/g;

/** '/_next/static/chunks/a-1.js' from a script src with host and query, or null if it is not a build file. */
export function scriptPath(src: string): string | null {
  const i = src.indexOf('/_next/static/');
  return i < 0 ? null : src.slice(i).split('?')[0];
}

/** The /_next/static/*.js files an HTML page names, without host or query. */
export function scriptFiles(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(SCRIPT_SRC)) {
    const path = scriptPath(m[1]);
    if (path) out.add(path);
  }
  return [...out];
}

/** True when the fresh page names a script file the running page never loaded. */
export function bundleIsStale(running: readonly string[], fresh: readonly string[]): boolean {
  if (fresh.length === 0) return false; // an error page or empty reply is not a new build
  const have = new Set(running);
  return fresh.some((f) => !have.has(f));
}

/** Reload at most once a minute, so a server that keeps serving odd HTML cannot loop. */
export function mayReload(lastReloadAt: number | null, now: number, minGapMs = 60_000): boolean {
  return lastReloadAt === null || now - lastReloadAt >= minGapMs;
}
