/**
 * The address a player or browser actually used to reach TwentyFourSeven, e.g.
 * `http://192.168.1.20:8247` on the LAN or `https://tv.example.com` behind a proxy.
 * Links we hand out (M3U, XMLTV, catch-up) must use it, or other players get
 * links that point somewhere they cannot reach.
 *
 * Order: X-Forwarded-Proto / X-Forwarded-Host (set by a reverse proxy, and passed
 * through by the bundled nginx), then the Host header (with its port), then the
 * request URL itself.
 */
type HeaderSource = { get(name: string): string | null };

function firstValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first ? first : null;
}

export function getPublicBaseUrl(headers: HeaderSource, requestUrl?: string): string {
  let fallbackProto = "http";
  let fallbackHost: string | null = null;
  if (requestUrl) {
    try {
      const u = new URL(requestUrl);
      fallbackProto = u.protocol.replace(/:$/, "") || "http";
      fallbackHost = u.host || null;
    } catch {
      // ignore malformed request URL
    }
  }

  const rawProto = firstValue(headers.get("x-forwarded-proto"))?.toLowerCase();
  const proto = rawProto === "https" || rawProto === "http" ? rawProto : fallbackProto;

  const rawHost =
    firstValue(headers.get("x-forwarded-host")) ||
    firstValue(headers.get("host")) ||
    fallbackHost ||
    "localhost";
  // Host header values never contain a scheme, path or whitespace; drop anything odd.
  const host = /^[A-Za-z0-9.\-:\[\]]+$/.test(rawHost) ? rawHost : "localhost";

  // Leave out the default port for the scheme (example.com:443 -> example.com).
  const cleanedHost =
    (proto === "https" && host.endsWith(":443")) || (proto === "http" && host.endsWith(":80"))
      ? host.replace(/:(443|80)$/, "")
      : host;

  return `${proto}://${cleanedHost}`;
}
