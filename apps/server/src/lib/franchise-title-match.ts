import { normalizeTitle } from './title-normalize';

export type TitleMatchTarget = {
  title: string;
  year?: number | null;
  tmdbId?: number | null;
  movieId?: string;
};

export type TitleMatchEntry = {
  movieId?: string | null;
  tmdbId?: number | null;
  titlePattern?: string | null;
  label?: string | null;
};

/** Higher = stronger match. Returns 0 when no confident match. */
export function scoreTitleMatch(
  movie: TitleMatchTarget,
  entry: TitleMatchEntry,
): number {
  if (entry.movieId && movie.movieId && entry.movieId === movie.movieId) {
    return 1000;
  }
  if (entry.tmdbId != null && movie.tmdbId != null && entry.tmdbId === movie.tmdbId) {
    return 1000;
  }

  const norm = normalizeTitle(movie.title);
  const withYear = movie.year
    ? normalizeTitle(`${movie.title} (${movie.year})`)
    : norm;
  const labelNorm = entry.label ? normalizeTitle(entry.label) : '';
  const pattern = entry.titlePattern?.trim() ?? '';
  const coreTitle = norm
    .replace(/^star wars episode (?:[ivx]+|\d+)\s*/i, '')
    .replace(/^star wars\s*/i, '')
    .trim();

  if (labelNorm && (norm === labelNorm || withYear === labelNorm)) {
    return 900;
  }
  if (labelNorm && coreTitle.length > 0 && coreTitle === labelNorm) {
    return 900;
  }
  if (
    labelNorm &&
    coreTitle.length >= 8 &&
    (labelNorm.endsWith(coreTitle) || coreTitle.endsWith(labelNorm))
  ) {
    return 850;
  }
  if (pattern && (norm === pattern || withYear === pattern)) {
    return 800;
  }
  if (pattern && coreTitle.length > 0 && coreTitle === pattern) {
    return 800;
  }

  return 0;
}

export function bestEntryPositionForMovie(
  movie: TitleMatchTarget,
  entries: Array<TitleMatchEntry & { position: number }>,
): number {
  let bestPosition = -1;
  let bestScore = 0;
  for (const entry of entries) {
    const score = scoreTitleMatch(movie, entry);
    if (score > bestScore) {
      bestScore = score;
      bestPosition = entry.position;
    }
  }
  return bestScore >= 800 ? bestPosition : -1;
}

/** Best Plex library movie for a franchise row, if any. */
export function findLibraryMovieForEntry<
  T extends TitleMatchTarget & { id?: string },
>(
  entry: TitleMatchEntry,
  libraryMovies: T[],
  usedMovieIds?: Set<string>,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const movie of libraryMovies) {
    if (usedMovieIds?.has(movie.id ?? '')) continue;
    const score = scoreTitleMatch(movie, entry);
    if (score > bestScore) {
      bestScore = score;
      best = movie;
    }
  }
  return bestScore >= 800 ? best : null;
}
