/**
 * A media server row as the browser may see it: everything except the access token.
 * `hasToken` tells the settings page whether a token is stored, so it can offer
 * "test" and "edit libraries" without ever holding the token itself.
 */
export function toPublicServer<T extends { token?: string | null }>(
  server: T,
): Omit<T, "token"> & { hasToken: boolean } {
  const { token, ...rest } = server;
  return { ...rest, hasToken: Boolean(token) };
}

/** Turns "" (an untouched token field) into "keep the stored token". */
export function tokenUpdate(token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Picks the URL and token for a Plex check. A token typed by the admin is used with
 * the URL they typed. Without one, the stored token is used, and only with the stored
 * URL, so it is never sent to an address the admin just typed in.
 */
export function resolvePlexCredentials(
  input: { url?: string; token?: string },
  stored: { url: string; token: string | null } | null,
): { url: string; token: string } | { error: string } {
  const typed = tokenUpdate(input.token);
  if (typed) {
    if (!input.url) return { error: "Enter the server URL" };
    return { url: input.url, token: typed };
  }
  if (!stored) return { error: "Enter an access token" };
  if (!stored.token) return { error: "No access token is stored for this server" };
  return { url: stored.url, token: stored.token };
}
