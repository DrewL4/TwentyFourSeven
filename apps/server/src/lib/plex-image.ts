import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Rules for the /images/plex proxy: which Plex paths it may fetch, how its links
 * are built, and how links handed to IPTV players are signed.
 *
 * The browser loads posters with its session cookie (an <img> tag sends cookies but
 * no Authorization header). IPTV players reading /media.m3u and /media.xml have no
 * session, so the links put in those files carry a signature instead. The signature
 * covers one origin and one image path, so it can't be reused to fetch anything else.
 */

export const PLEX_IMAGE_ROUTE = "/images/plex";

const LIBRARY_IMAGE_PATH = /^\/library\/(metadata|collections)\/\d+\/(thumb|art|composite)(\/\d+)?$/;
const TRANSCODE_PATH = "/photo/:/transcode";
/** Query parameters Plex's photo transcoder needs; everything else is dropped. */
const TRANSCODE_PARAMS = ["width", "height", "minSize", "upscale", "format", "quality", "url"] as const;

export type PlexImageTarget = {
  /** Scheme, host and port of the Plex server, e.g. http://plex.lan:32400 */
  origin: string;
  /** Path plus the allowed query, in a fixed order; this is what gets signed. */
  path: string;
};

function isLibraryImagePath(pathname: string): boolean {
  return LIBRARY_IMAGE_PATH.test(pathname);
}

/**
 * Check an origin and image path and return them in canonical form, or null when the
 * path isn't a Plex artwork path. Any X-Plex-Token in the input is dropped.
 */
export function normalizePlexImageTarget(origin: string, pathWithQuery: string): PlexImageTarget | null {
  let originUrl: URL;
  let target: URL;
  try {
    originUrl = new URL(origin);
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return null;
    if (!pathWithQuery.startsWith("/") || pathWithQuery.startsWith("//")) return null;
    // URL parsing resolves "..", "%2e%2e" and friends before the path is checked.
    target = new URL(pathWithQuery, originUrl.origin);
  } catch {
    return null;
  }
  if (target.origin !== originUrl.origin) return null;

  if (isLibraryImagePath(target.pathname)) {
    return { origin: originUrl.origin, path: target.pathname };
  }

  if (target.pathname === TRANSCODE_PATH) {
    const inner = target.searchParams.get("url");
    if (!inner) return null;
    let innerUrl: URL;
    try {
      // The transcoder must only be pointed at this server's own artwork.
      if (!inner.startsWith("/") || inner.startsWith("//")) return null;
      innerUrl = new URL(inner, originUrl.origin);
    } catch {
      return null;
    }
    if (innerUrl.origin !== originUrl.origin || !isLibraryImagePath(innerUrl.pathname)) return null;
    const kept = new URLSearchParams();
    for (const key of TRANSCODE_PARAMS) {
      const value = key === "url" ? innerUrl.pathname : target.searchParams.get(key);
      if (value !== null && value !== "") kept.set(key, value);
    }
    return { origin: originUrl.origin, path: `${TRANSCODE_PATH}?${kept.toString()}` };
  }

  return null;
}

/** Same origin, ignoring a trailing slash or path in the configured server URL. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function signingKey(plexToken: string): Buffer {
  // Derived from the server's token: nothing new to store, and links stop
  // working if the token is changed.
  return createHash("sha256").update(`tfs-plex-image-v1:${plexToken}`).digest();
}

export function signPlexImageTarget(target: PlexImageTarget, plexToken: string): string {
  return createHmac("sha256", signingKey(plexToken))
    .update(`${target.origin}\n${target.path}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyPlexImageSignature(
  target: PlexImageTarget,
  plexToken: string,
  signature: string | null | undefined,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signPlexImageTarget(target, plexToken));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** `/images/plex?origin=…&path=…[&sig=…]`, optionally prefixed with a base URL. */
export function buildPlexImageLink(target: PlexImageTarget, options: { baseUrl?: string; sig?: string } = {}): string {
  const params = new URLSearchParams({ origin: target.origin, path: target.path });
  if (options.sig) params.set("sig", options.sig);
  return `${options.baseUrl ?? ""}${PLEX_IMAGE_ROUTE}?${params.toString()}`;
}

/**
 * Read the Plex target out of either a direct Plex URL (http://plex:32400/library/…)
 * or an existing /images/plex link (relative or absolute).
 */
export function parsePlexImageReference(value: string): PlexImageTarget | null {
  let url: URL;
  try {
    url = new URL(value, "http://relative.invalid");
  } catch {
    return null;
  }
  if (url.pathname === PLEX_IMAGE_ROUTE || url.pathname.endsWith(PLEX_IMAGE_ROUTE)) {
    const rawUrl = url.searchParams.get("url");
    if (rawUrl) {
      try {
        const inner = new URL(rawUrl);
        inner.searchParams.delete("X-Plex-Token");
        return normalizePlexImageTarget(inner.origin, inner.pathname + inner.search);
      } catch {
        return null;
      }
    }
    const origin = url.searchParams.get("origin");
    const path = url.searchParams.get("path");
    return origin && path ? normalizePlexImageTarget(origin, path) : null;
  }
  if (url.origin === "http://relative.invalid") return null;
  url.searchParams.delete("X-Plex-Token");
  return normalizePlexImageTarget(url.origin, url.pathname + url.search);
}

const TOKEN_PARAM = /([?&])X-Plex-Token=[^&#"'\s]*&?/gi;

/** Drop X-Plex-Token from a URL-ish string, leaving the rest alone. */
export function stripPlexToken(value: string): string {
  return value.replace(TOKEN_PARAM, (_m, lead: string) => lead).replace(/[?&]$/, "");
}

type PlexServerLike = { url: string; token: string | null };

/**
 * Link maker for files read by IPTV players (/media.m3u, /media.xml): turns a Plex
 * artwork URL or an /images/plex link into a signed /images/plex link. Values that
 * aren't Plex artwork are returned unchanged, except that any token is removed.
 */
export function createPlayerImageLinker(servers: PlexServerLike[]) {
  return (value: string, baseUrl: string): string => {
    const target = parsePlexImageReference(value);
    if (!target) return stripPlexToken(value);
    const server = servers.find((s) => s.token && sameOrigin(s.url, target.origin));
    if (!server?.token) return buildPlexImageLink(target, { baseUrl });
    return buildPlexImageLink(target, { baseUrl, sig: signPlexImageTarget(target, server.token) });
  };
}
