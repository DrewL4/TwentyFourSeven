/** Whether a Cookie header carries a Better Auth session token (signed or not, secure prefix or not). */
export function hasSessionCookie(cookie: string | null | undefined): boolean {
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=[^;\s]/.test(cookie || "");
}

export type SessionCheck = "none" | "dead" | "error";

/**
 * Whether a request with nothing else valid gets the home-network pass.
 * A sign-in cookie that no longer resolves (or couldn't be checked) is not
 * "nobody": that browser belongs to a person with a stream limit.
 */
export function homeNetworkFallback(r: {
  hasCredential: boolean;
  allowLan: boolean;
  privateAddress: boolean;
  lanWithoutKey: boolean;
  session: SessionCheck;
}): "lan" | "session-expired" | "session-unavailable" | "deny" {
  if (r.hasCredential || !r.allowLan || !r.privateAddress || !r.lanWithoutKey) return "deny";
  if (r.session === "dead") return "session-expired";
  if (r.session === "error") return "session-unavailable";
  return "lan";
}
