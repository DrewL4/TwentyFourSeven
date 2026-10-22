import { buildPlexImageLink, parsePlexImageReference, stripPlexToken } from "./plex-image";

/**
 * For API data sent to the browser: Plex artwork URLs become /images/plex links
 * (the browser's session cookie authorizes them); any other URL just loses its token.
 */
export function toBrowserSafeUrl(value: string): string {
  if (!/X-Plex-Token/i.test(value)) return value;
  const target = parsePlexImageReference(value);
  if (target) return buildPlexImageLink(target);
  return stripPlexToken(value);
}

/**
 * Walk an API result and rewrite every string holding a Plex token. Returns the
 * input unchanged (same object) when there's nothing to rewrite.
 */
export function scrubPlexTokens<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") {
    return toBrowserSafeUrl(value) as T;
  }
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (typeof (value as { getReader?: unknown }).getReader === "function") return value; // streams
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = scrubPlexTokens(item, seen);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? out : value) as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  let out: Record<string, unknown> | null = null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const next = scrubPlexTokens(item, seen);
    if (next !== item) {
      out ??= { ...(value as Record<string, unknown>) };
      out[key] = next;
    }
  }
  return (out ?? value) as T;
}

