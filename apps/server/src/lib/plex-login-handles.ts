import { randomBytes } from "node:crypto";

/**
 * Plex sign-in returns plex.tv tokens. The browser only needs to pick a server,
 * so it gets an opaque handle instead; the server swaps it back when the admin
 * tests, lists libraries or saves the server. Handles live in memory for 10 minutes.
 */
const PREFIX = "plexref_";
const TTL_MS = 10 * 60_000;
const handles = new Map<string, { token: string; expiresAt: number }>();

export function issuePlexTokenHandle(token: string): string {
  const now = Date.now();
  for (const [k, v] of handles) if (v.expiresAt < now) handles.delete(k);
  const handle = PREFIX + randomBytes(18).toString("base64url");
  handles.set(handle, { token, expiresAt: now + TTL_MS });
  return handle;
}

export function isPlexTokenHandle(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** The real token for a handle, or null when it expired or never existed. */
export function redeemPlexTokenHandle(handle: string): string | null {
  const row = handles.get(handle);
  if (!row || row.expiresAt < Date.now()) return null;
  return row.token;
}
