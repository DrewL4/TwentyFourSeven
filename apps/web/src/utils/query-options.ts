/** React Query tuning for large payloads (guide, library). */
export const HEAVY_QUERY_OPTIONS = {
  staleTime: 60 * 1000,
  gcTime: 2 * 60 * 1000,
} as const;

/** Channel lineup/detail — changes less often than live guide data. */
export const CHANNEL_DETAIL_OPTIONS = {
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
} as const;

/** Library stats and server/library metadata — changes infrequently. */
export const LIBRARY_LIST_OPTIONS = {
  staleTime: 3 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
} as const;
