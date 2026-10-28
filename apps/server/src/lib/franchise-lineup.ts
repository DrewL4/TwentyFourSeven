/**
 * Turns a franchise's saved entries into the play lineup for its channel when the franchise
 * includes TV shows: movies, whole shows, seasons and episode ranges in franchise order.
 * Pure: the scheduler loads the rows and hands them in. Returns null when there is nothing
 * to do differently (no TV entries found in the library), so a movie-only franchise keeps
 * using the channel's own movie list exactly as before.
 */

export type LineupEpisode = { seasonNumber: number; episodeNumber: number; duration: number };
export type LineupMovie = { duration: number };

export type LineupEntry<M extends LineupMovie, E extends LineupEpisode> = {
  kind: string;
  movie: M | null;
  show: { title: string; episodes: E[] } | null;
  seasonNumber: number | null;
  episodeStart: number | null;
  episodeEnd: number | null;
};

export type LineupItem<M extends LineupMovie, E extends LineupEpisode> =
  | { type: 'movie'; content: M; duration: number }
  | { type: 'episode'; content: E; showTitle: string; duration: number };

export function episodesForEntry<E extends LineupEpisode>(
  episodes: readonly E[],
  entry: Pick<LineupEntry<LineupMovie, E>, 'kind' | 'seasonNumber' | 'episodeStart' | 'episodeEnd'>,
): E[] {
  const sorted = [...episodes].sort(
    (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
  );
  if (entry.kind === 'SEASON') {
    return sorted.filter((e) => e.seasonNumber === entry.seasonNumber);
  }
  if (entry.kind === 'EPISODES') {
    const from = entry.episodeStart ?? 1;
    const to = entry.episodeEnd ?? Number.MAX_SAFE_INTEGER;
    return sorted.filter((e) => e.seasonNumber === entry.seasonNumber && e.episodeNumber >= from && e.episodeNumber <= to);
  }
  // Whole show: skip season 0 (specials, extras) so they do not interrupt the story.
  return sorted.filter((e) => e.seasonNumber > 0);
}

export function buildFranchiseLineup<M extends LineupMovie, E extends LineupEpisode>(
  entries: ReadonlyArray<LineupEntry<M, E>>,
): Array<LineupItem<M, E>> | null {
  const items: Array<LineupItem<M, E>> = [];
  let sawEpisodes = false;
  for (const entry of entries) {
    if (entry.kind === 'MOVIE' || !entry.kind) {
      if (entry.movie) items.push({ type: 'movie', content: entry.movie, duration: entry.movie.duration });
      continue;
    }
    if (!entry.show) continue;
    for (const ep of episodesForEntry(entry.show.episodes, entry)) {
      items.push({ type: 'episode', content: ep, showTitle: entry.show.title, duration: ep.duration });
      sawEpisodes = true;
    }
  }
  if (!sawEpisodes || items.length === 0) return null;
  return items;
}
