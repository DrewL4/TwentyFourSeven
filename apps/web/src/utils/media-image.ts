/**
 * Plex artwork is stored as `http://<plex>/library/...?X-Plex-Token=...`.
 * Loading that straight into an <img> fails whenever the browser can't reach
 * the Plex address TwentyFourSeven uses (a Docker name, a LAN IP from outside,
 * plain http on an https page), and it hands the Plex token to every browser.
 * Route it through TwentyFourSeven's /images/plex proxy instead, which adds the
 * token on the server side. Other URLs are returned unchanged.
 */
export function mediaImageSrc(url?: string | null): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // relative or unparseable: leave alone
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.searchParams.has("X-Plex-Token")) {
    return url;
  }
  parsed.searchParams.delete("X-Plex-Token");
  const pathWithQuery = parsed.pathname + parsed.search;
  return `/images/plex?origin=${encodeURIComponent(parsed.origin)}&path=${encodeURIComponent(pathWithQuery)}`;
}
