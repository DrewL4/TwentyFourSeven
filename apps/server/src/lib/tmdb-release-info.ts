import { maintainBoundedMap, type TimestampedEntry } from './bounded-cache';

/**
 * Release dates for titles that are not out yet: a movie's theatrical and digital dates (TMDB
 * release_dates, type 3 and type 4) and a show's premiere / next episode. Looked up one title at a
 * time, kept in a small time-limited cache so a franchise page never asks TMDB twice for the same
 * title, and never loads a list that grows with the library.
 */

export type MovieReleaseInfo = {
  kind: 'movie';
  /** TMDB's own status, e.g. "Released", "Post Production", "In Production". */
  status: string | null;
  /** YYYY-MM-DD, or null when TMDB has no such date. */
  theatrical: string | null;
  digital: string | null;
  /** The movie's primary release date from TMDB. */
  releaseDate: string | null;
};

export type TvReleaseInfo = {
  kind: 'tv';
  status: string | null;
  firstAirDate: string | null;
  nextEpisodeAirDate: string | null;
  nextEpisode: { season: number; episode: number } | null;
  /** Season premiere dates by season number. */
  seasonAirDates: Record<number, string | null>;
};

export type ReleaseInfo = MovieReleaseInfo | TvReleaseInfo;

type ReleaseDatesBlock = {
  results?: Array<{
    iso_3166_1?: string;
    release_dates?: Array<{ type?: number; release_date?: string }>;
  }>;
};

const day = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
};

/** The earliest date of one release type in one country list (US first), or null. */
function pickDate(block: ReleaseDatesBlock | undefined, types: number[], preferred = 'US'): string | null {
  const rows = block?.results ?? [];
  const datesFor = (country: typeof rows) => {
    const out: string[] = [];
    for (const c of country) {
      for (const r of c.release_dates ?? []) {
        const d = day(r.release_date);
        if (d && r.type != null && types.includes(r.type)) out.push(d);
      }
    }
    return out.sort();
  };
  const us = datesFor(rows.filter((r) => r.iso_3166_1 === preferred));
  if (us.length) return us[0];
  // No US date for this type: the earliest anywhere is the best honest answer.
  const any = datesFor(rows);
  return any.length ? any[0] : null;
}

export function parseMovieRelease(data: {
  status?: string;
  release_date?: string;
  release_dates?: ReleaseDatesBlock;
}): MovieReleaseInfo {
  // Type 3 = theatrical, 2 = limited theatrical (only used when there is no wide date), 4 = digital.
  const theatrical = pickDate(data.release_dates, [3]) ?? pickDate(data.release_dates, [2]);
  const digital = pickDate(data.release_dates, [4]);
  return {
    kind: 'movie',
    status: data.status ?? null,
    theatrical,
    digital,
    releaseDate: day(data.release_date),
  };
}

export function parseTvRelease(data: {
  status?: string;
  first_air_date?: string;
  next_episode_to_air?: { air_date?: string; season_number?: number; episode_number?: number } | null;
  seasons?: Array<{ season_number: number; air_date?: string | null }>;
}): TvReleaseInfo {
  const next = data.next_episode_to_air;
  const seasonAirDates: Record<number, string | null> = {};
  for (const s of data.seasons ?? []) seasonAirDates[s.season_number] = day(s.air_date);
  return {
    kind: 'tv',
    status: data.status ?? null,
    firstAirDate: day(data.first_air_date),
    nextEpisodeAirDate: day(next?.air_date),
    nextEpisode:
      next && next.season_number != null && next.episode_number != null
        ? { season: next.season_number, episode: next.episode_number }
        : null,
    seasonAirDates,
  };
}

export type TmdbJsonFetch = <T>(path: string) => Promise<T>;

const TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 600;
const cache = new Map<string, TimestampedEntry<ReleaseInfo | null>>();
const inflight = new Map<string, Promise<ReleaseInfo | null>>();

export function clearReleaseInfoCache(): void {
  cache.clear();
  inflight.clear();
}

export function releaseInfoCacheSize(): number {
  return cache.size;
}

async function loadOne(kind: 'movie' | 'tv', tmdbId: number, get: TmdbJsonFetch): Promise<ReleaseInfo | null> {
  const key = `${kind}:${tmdbId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.timestamp < (hit.value ? TTL_MS : MISS_TTL_MS)) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      const value =
        kind === 'movie'
          ? parseMovieRelease(await get(`/movie/${tmdbId}?append_to_response=release_dates`))
          : parseTvRelease(await get(`/tv/${tmdbId}`));
      cache.set(key, { value, timestamp: Date.now() });
      return value;
    } catch {
      // TMDB down or the id unknown: remember the miss briefly so a page does not retry per row.
      cache.set(key, { value: null, timestamp: Date.now() });
      return null;
    } finally {
      inflight.delete(key);
      maintainBoundedMap(cache, { ttlMs: TTL_MS, maxEntries: MAX_ENTRIES });
    }
  })();
  inflight.set(key, job);
  return job;
}

/**
 * Release info for several titles, at most `concurrency` TMDB calls at a time. A title that
 * cannot be fetched is simply missing from the result.
 */
export async function loadReleaseInfo(
  titles: Array<{ kind: 'movie' | 'tv'; tmdbId: number }>,
  get: TmdbJsonFetch,
  opts: { concurrency?: number; maxTitles?: number } = {},
): Promise<Map<string, ReleaseInfo>> {
  const unique = new Map<string, { kind: 'movie' | 'tv'; tmdbId: number }>();
  for (const t of titles) unique.set(`${t.kind}:${t.tmdbId}`, t);
  const list = [...unique.entries()].slice(0, opts.maxTitles ?? 40);
  const out = new Map<string, ReleaseInfo>();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const [key, t] = list[next++];
      const info = await loadOne(t.kind, t.tmdbId, get);
      if (info) out.set(key, info);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 5, list.length) }, worker));
  return out;
}

/** What the page shows about an upcoming title. Dates are YYYY-MM-DD. */
export type ReleaseView = {
  /** Movies: wide theatrical date and whether it has passed. */
  theatrical: string | null;
  theatricalOut: boolean;
  /** Movies: digital (home) release date and whether it has passed. */
  digital: string | null;
  digitalOut: boolean;
  /** Movies with only a single date to go on, or a show / season premiere that is still ahead. */
  coming: string | null;
  /** Shows: the next episode that has not aired yet. */
  nextEpisode: string | null;
  /** True when TMDB says the title is announced but has no date yet. */
  undated: boolean;
};

const EMPTY_VIEW: ReleaseView = {
  theatrical: null,
  theatricalOut: false,
  digital: null,
  digitalOut: false,
  coming: null,
  nextEpisode: null,
  undated: false,
};

const UNRELEASED_STATUS = /planned|in production|post production|rumored|pilot/i;

/**
 * The release line for one entry that is not in the library, or null when there is nothing worth
 * saying (already out everywhere, or no date to go on). `today` is YYYY-MM-DD.
 */
export function releaseViewFor(
  entry: { kind: string; seasonNumber: number | null; releaseDate: string | null },
  info: ReleaseInfo | null | undefined,
  wtDates: { theatrical: string | null; earliest: string | null } | null | undefined,
  today: string,
): ReleaseView | null {
  const future = (d: string | null) => (d && d > today ? d : null);
  if (entry.kind === 'MOVIE') {
    const m = info && info.kind === 'movie' ? info : null;
    const theatrical = m?.theatrical ?? wtDates?.theatrical ?? null;
    const digital = m?.digital ?? null;
    const primary = m?.releaseDate ?? day(entry.releaseDate) ?? wtDates?.earliest ?? null;
    const theatricalOut = !!theatrical && theatrical <= today;
    const digitalOut = !!digital && digital <= today;
    if (future(theatrical) || future(digital)) {
      return { ...EMPTY_VIEW, theatrical, theatricalOut, digital, digitalOut };
    }
    if (future(primary)) return { ...EMPTY_VIEW, coming: primary };
    if (!primary && m && UNRELEASED_STATUS.test(m.status ?? '')) return { ...EMPTY_VIEW, undated: true };
    return null;
  }
  const t = info && info.kind === 'tv' ? info : null;
  if (!t) {
    const first = future(day(entry.releaseDate));
    return first ? { ...EMPTY_VIEW, coming: first } : null;
  }
  let premiere: string | null;
  if (entry.kind === 'SHOW') premiere = future(t.firstAirDate);
  else premiere = future(entry.seasonNumber != null ? (t.seasonAirDates[entry.seasonNumber] ?? null) : null);
  const nextEpisode = entry.kind === 'SHOW' ? future(t.nextEpisodeAirDate) : null;
  if (!premiere && !nextEpisode) {
    return !t.firstAirDate && UNRELEASED_STATUS.test(t.status ?? '') ? { ...EMPTY_VIEW, undated: true } : null;
  }
  return { ...EMPTY_VIEW, coming: premiere, nextEpisode: premiere ? null : nextEpisode };
}

/** Which of these entries are worth a TMDB release lookup (not out long ago, or a show). */
export function needsReleaseLookup(
  entry: { kind: string; tmdbId: number | null; releaseDate: string | null },
  today: string,
): boolean {
  if (entry.tmdbId == null) return false;
  if (entry.kind !== 'MOVIE') return true;
  const d = day(entry.releaseDate);
  if (!d) return true;
  // A movie that came out in the last half year can still have its digital release ahead.
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 183 * 86_400_000).toISOString().slice(0, 10);
  return d >= cutoff;
}
