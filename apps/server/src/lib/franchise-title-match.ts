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

/** A movie with its normalized forms computed once, so a big library is not re-normalized per entry. */
export type PreparedMovie = {
  movieId?: string;
  tmdbId?: number | null;
  norm: string;
  withYear: string;
  coreTitle: string;
};

export type PreparedEntry = {
  movieId?: string | null;
  tmdbId?: number | null;
  labelNorm: string;
  pattern: string;
};

export function prepareMovie(movie: TitleMatchTarget): PreparedMovie {
  const norm = normalizeTitle(movie.title);
  const withYear = movie.year ? normalizeTitle(`${movie.title} (${movie.year})`) : norm;
  const coreTitle = norm
    .replace(/^star wars episode (?:[ivx]+|\d+)\s*/i, '')
    .replace(/^star wars\s*/i, '')
    .trim();
  return { movieId: movie.movieId, tmdbId: movie.tmdbId, norm, withYear, coreTitle };
}

export function prepareEntry(entry: TitleMatchEntry): PreparedEntry {
  return {
    movieId: entry.movieId,
    tmdbId: entry.tmdbId,
    labelNorm: entry.label ? normalizeTitle(entry.label) : '',
    pattern: entry.titlePattern?.trim() ?? '',
  };
}

/** Same scoring as scoreTitleMatch, on values prepared once. */
export function scorePrepared(movie: PreparedMovie, entry: PreparedEntry): number {
  if (entry.movieId && movie.movieId && entry.movieId === movie.movieId) return 1000;
  if (entry.tmdbId != null && movie.tmdbId != null && entry.tmdbId === movie.tmdbId) return 1000;
  const { norm, withYear, coreTitle } = movie;
  const { labelNorm, pattern } = entry;
  if (labelNorm && (norm === labelNorm || withYear === labelNorm)) return 900;
  if (labelNorm && coreTitle.length > 0 && coreTitle === labelNorm) return 900;
  if (labelNorm && coreTitle.length >= 8 && (labelNorm.endsWith(coreTitle) || coreTitle.endsWith(labelNorm))) return 850;
  if (pattern && (norm === pattern || withYear === pattern)) return 800;
  if (pattern && coreTitle.length > 0 && coreTitle === pattern) return 800;
  return 0;
}

/** Higher = stronger match. Returns 0 when no confident match. */
export function scoreTitleMatch(movie: TitleMatchTarget, entry: TitleMatchEntry): number {
  return scorePrepared(prepareMovie(movie), prepareEntry(entry));
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

export type PreparedLibraryMovie<T> = { movie: T; prepared: PreparedMovie };

/** Normalize a movie list once, then match many entries against it (see findPreparedMovieForEntry). */
export function prepareLibrary<T extends TitleMatchTarget>(movies: T[]): Array<PreparedLibraryMovie<T>> {
  return movies.map((movie) => ({ movie, prepared: prepareMovie(movie) }));
}

/** Same result as findLibraryMovieForEntry, without re-normalizing every movie for every entry. */
export function findPreparedMovieForEntry<T extends TitleMatchTarget & { id?: string }>(
  entry: TitleMatchEntry,
  library: Array<PreparedLibraryMovie<T>>,
  usedMovieIds?: Set<string>,
): T | null {
  const prepared = prepareEntry(entry);
  let best: T | null = null;
  let bestScore = 0;
  for (const row of library) {
    if (usedMovieIds?.has(row.movie.id ?? '')) continue;
    const score = scorePrepared(row.prepared, prepared);
    if (score > bestScore) {
      bestScore = score;
      best = row.movie;
    }
  }
  return bestScore >= 800 ? best : null;
}
