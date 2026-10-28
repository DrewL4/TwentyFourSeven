import type { WtRequestItem } from './wt-requests';

/**
 * What of a franchise is in the library, and how to ask WatchTower for the rest.
 * Pure: the router loads library rows and hands them in.
 */

export type AvailabilityEntry = {
  kind: string;
  seasonNumber: number | null;
  episodeStart: number | null;
  episodeEnd: number | null;
  movieId: string | null;
  showId: string | null;
};

export type EpisodeRef = { seasonNumber: number; episodeNumber: number };

export type Availability = {
  available: boolean;
  /** Episodes found / episodes wanted (only known for an episode range). */
  have: number | null;
  want: number | null;
};

export function entryAvailability(entry: AvailabilityEntry, episodes: readonly EpisodeRef[] | undefined): Availability {
  if (entry.kind === 'MOVIE') {
    return { available: entry.movieId != null, have: null, want: null };
  }
  if (!entry.showId || !episodes) return { available: false, have: 0, want: null };
  if (entry.kind === 'SEASON') {
    const have = episodes.filter((e) => e.seasonNumber === entry.seasonNumber).length;
    return { available: have > 0, have, want: null };
  }
  if (entry.kind === 'EPISODES') {
    const from = entry.episodeStart ?? 1;
    const to = entry.episodeEnd ?? from;
    const have = episodes.filter(
      (e) => e.seasonNumber === entry.seasonNumber && e.episodeNumber >= from && e.episodeNumber <= to,
    ).length;
    const want = to - from + 1;
    return { available: have >= want, have, want };
  }
  const have = episodes.filter((e) => e.seasonNumber > 0).length;
  return { available: have > 0, have, want: null };
}

/** The show's own name, from a label like "Loki - Season 2" or "Show - S1 E1-6". */
export function showTitleFromLabel(label: string): string {
  return label
    .replace(/\s-\sSeason\s\d+$/, '')
    .replace(/\s-\sS\d+\sE\d+-\d+$/, '')
    .trim();
}

export type RequestableEntry = {
  kind: string;
  label: string | null;
  tmdbId: number | null;
  seasonNumber: number | null;
  posterPath: string | null;
};

/**
 * One WatchTower request for an entry, or null when it cannot be requested (no TMDB id yet).
 * An episode range is requested as its season: WatchTower has no range request, and the season
 * is the smallest request that covers every episode in the range.
 */
export function requestItemForEntry(entry: RequestableEntry): WtRequestItem | null {
  if (entry.tmdbId == null || !entry.label) return null;
  const poster = entry.posterPath ?? null;
  switch (entry.kind) {
    case 'MOVIE':
      return { title: entry.label, mediaType: 'movie', tmdbId: entry.tmdbId, posterPath: poster };
    case 'SHOW':
      return { title: entry.label, mediaType: 'tv', tmdbId: entry.tmdbId, posterPath: poster };
    case 'SEASON':
    case 'EPISODES':
      if (entry.seasonNumber == null) return null;
      return {
        title: showTitleFromLabel(entry.label),
        mediaType: 'season',
        tmdbId: entry.tmdbId,
        seasonNumber: entry.seasonNumber,
        posterPath: poster,
      };
    default:
      return null;
  }
}
