import { maintainBoundedMap, type TimestampedEntry } from './bounded-cache';
import { WT_NO_TOKEN_MESSAGE } from './wt-requests';

/**
 * What WatchTower knows about requests for a list of titles, as the signed-in user. One call per
 * franchise view (WatchTower's POST /api/requests/lookup/), answers kept for a short time, and any
 * failure comes back as `ok: false` with a plain reason instead of an error, so the page still
 * works when WatchTower is down, old, or does not know the signed-in user.
 */

export type WtState = 'pending' | 'approved' | 'downloading' | 'available' | 'denied' | 'failed' | 'requested';

export type WtLookupItem = {
  mediaType: 'movie' | 'tv' | 'season';
  tmdbId: number;
  seasonNumber?: number | null;
};

export type WtStatus = {
  state: WtState;
  /** True when the signed-in user is one of the people who asked. Never says who else did. */
  requestedByMe: boolean;
  /** Release dates WatchTower stored with the request (YYYY-MM-DD). */
  theatricalDate: string | null;
  earliestDate: string | null;
};

export type WtLookupFailure = 'no-token' | 'no-watchtower' | 'unauthorized' | 'unsupported' | 'unreachable';

export type WtLookupResult =
  | { ok: true; statuses: Map<string, WtStatus | null> }
  | { ok: false; reason: WtLookupFailure; message: string };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function wtItemKey(item: WtLookupItem): string {
  return `${item.mediaType}:${item.tmdbId}:${item.mediaType === 'season' ? (item.seasonNumber ?? '') : ''}`;
}

/** Map WatchTower's own status words onto the few the page shows. */
export function wtStateFrom(status: unknown): WtState {
  switch (status) {
    case 'pending':
    case 'approved':
    case 'downloading':
    case 'available':
    case 'denied':
    case 'failed':
      return status;
    default:
      return 'requested';
  }
}

const STATUS_TTL_MS = 30_000;
const MAX_ENTRIES = 1500;
const BATCH = 100;
const DOWN_MEMO_MS = 15_000;

const cache = new Map<string, TimestampedEntry<WtStatus | null>>();
const failures = new Map<string, TimestampedEntry<Extract<WtLookupResult, { ok: false }>>>();

export function clearWtStatusCache(): void {
  cache.clear();
  failures.clear();
}

export function wtStatusCacheSize(): number {
  return cache.size;
}

/** Forget what was cached for one user (after they request something, the next view must be fresh). */
export function forgetUserWtStatuses(userId: string): void {
  const prefix = `${userId}\n`;
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}

export async function lookupWtStatuses(
  opts: { baseUrl: string | null; userId: string; userToken: string | null; items: WtLookupItem[] },
  fetchImpl: FetchLike = fetch,
): Promise<WtLookupResult> {
  if (!opts.userToken) return { ok: false, reason: 'no-token', message: WT_NO_TOKEN_MESSAGE };
  const baseUrl = opts.baseUrl?.trim().replace(/\/+$/, '');
  if (!baseUrl) return { ok: false, reason: 'no-watchtower', message: 'WatchTower is not set up on this server yet.' };

  const statuses = new Map<string, WtStatus | null>();
  const unique = new Map<string, WtLookupItem>();
  for (const item of opts.items) unique.set(wtItemKey(item), item);
  const prefix = `${opts.userId}\n${baseUrl}\n`;
  const missing: Array<[string, WtLookupItem]> = [];
  const now = Date.now();
  for (const [key, item] of unique) {
    const hit = cache.get(prefix + key);
    if (hit && now - hit.timestamp < STATUS_TTL_MS) statuses.set(key, hit.value);
    else missing.push([key, item]);
  }
  if (missing.length === 0) return { ok: true, statuses };

  // WatchTower just failed: do not make every page view wait on it again for a few seconds.
  const recent = failures.get(prefix);
  if (recent && now - recent.timestamp < DOWN_MEMO_MS) return recent.value;

  const fail = (reason: WtLookupFailure, message: string): WtLookupResult => {
    const value = { ok: false as const, reason, message };
    failures.set(prefix, { value, timestamp: Date.now() });
    return value;
  };

  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/api/requests/lookup/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Token ${opts.userToken}`,
        },
        body: JSON.stringify({
          items: chunk.map(([, it]) => ({
            tmdb_id: it.tmdbId,
            media_type: it.mediaType,
            ...(it.mediaType === 'season' && it.seasonNumber != null ? { season_number: it.seasonNumber } : {}),
          })),
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(6_000),
      });
    } catch {
      return fail('unreachable', 'WatchTower could not be reached, so request status is not shown right now.');
    }
    if (response.status === 401 || response.status === 403) {
      return fail('unauthorized', 'WatchTower did not accept your sign-in. Sign out of 24/7 and sign in again.');
    }
    if (response.status === 404 || response.status === 405) {
      return fail('unsupported', 'This WatchTower cannot report request status yet.');
    }
    if (!response.ok) return fail('unreachable', `WatchTower could not report request status (${response.status}).`);
    const data = (await response.json().catch(() => null)) as { results?: unknown } | null;
    const results = Array.isArray(data?.results) ? (data!.results as Array<Record<string, unknown>>) : null;
    if (!results || results.length !== chunk.length) {
      return fail('unreachable', 'WatchTower sent back an answer 24/7 could not read.');
    }
    chunk.forEach(([key], index) => {
      const row = results[index];
      const status: WtStatus | null = row?.requested
        ? {
            state: wtStateFrom(row.status),
            requestedByMe: row.requested_by_me === true,
            theatricalDate: typeof row.theatrical_release_date === 'string' ? row.theatrical_release_date.slice(0, 10) : null,
            earliestDate: typeof row.earliest_release_date === 'string' ? row.earliest_release_date.slice(0, 10) : null,
          }
        : null;
      statuses.set(key, status);
      cache.set(prefix + key, { value: status, timestamp: Date.now() });
    });
  }
  maintainBoundedMap(cache, { ttlMs: STATUS_TTL_MS * 4, maxEntries: MAX_ENTRIES });
  maintainBoundedMap(failures, { ttlMs: DOWN_MEMO_MS * 4, maxEntries: 200 });
  return { ok: true, statuses };
}
