import { LOCAL_IMAGE_ROUTE } from "./plex-image";

/**
 * Turns a channel's stored icon into a value the player image linker
 * (createPlayerImageLinker) can use:
 * - http(s) URLs come back normalised;
 * - locally stored artwork (/images/local/...) comes back as is; the linker prefixes the
 *   public base URL and adds the image pass, as it does for local posters;
 * - protocol-relative URLs (//host/logo.png) get `scheme`, the scheme the client used.
 *   The cached XMLTV guide passes a placeholder that is filled in per request.
 * Anything else (empty, relative, malformed) gives null.
 */
export function channelIconSource(icon: string | null | undefined, scheme: string): string | null {
  if (!icon) return null;
  if (icon.startsWith(LOCAL_IMAGE_ROUTE)) return icon;
  try {
    if (icon.startsWith("//")) {
      new URL(`http:${icon}`); // validate the host part; the scheme may be a placeholder
      return `${scheme}:${icon}`;
    }
    if (!/^https?:\/\//i.test(icon)) return null;
    return new URL(icon).toString();
  } catch {
    return null;
  }
}

/** The scheme of a public base URL such as `https://tv.example.com`. */
export function schemeOf(baseUrl: string): string {
  return baseUrl.slice(0, baseUrl.indexOf(":")) || "http";
}
