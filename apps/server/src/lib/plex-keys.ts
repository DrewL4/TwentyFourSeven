/**
 * Plex rating keys and library section keys are numbers. They end up in Plex URL paths
 * (sent with the server's X-Plex-Token) and in the database, so anything else is refused.
 */
const PLEX_KEY = /^[0-9]{1,12}$/;

export function isPlexKey(value: unknown): boolean {
  return (typeof value === "string" || typeof value === "number") && PLEX_KEY.test(String(value));
}

/** One URL path segment for a Plex key; "/" and ".." cannot reach other Plex endpoints. */
export function plexKeySegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

/** The first webhook Metadata key that is present but not a Plex key, or null. */
export function badPlexWebhookKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  for (const field of ["ratingKey", "parentRatingKey", "grandparentRatingKey", "librarySectionID"]) {
    const v = m[field];
    if (v !== undefined && v !== null && !isPlexKey(v)) return field;
  }
  return null;
}
