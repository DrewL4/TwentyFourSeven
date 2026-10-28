const TMDB_API_BASE = 'https://api.themoviedb.org/3';

export type TmdbCollectionPart = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
};

export type TmdbCollectionDetails = {
  id: number;
  name: string;
  overview?: string;
  parts: TmdbCollectionPart[];
};

function getTmdbApiKey(): string | null {
  const fromEnv = process.env.TMDB_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

export async function getTmdbApiKeyFromSettings(): Promise<string | null> {
  const { prisma } = await import('./prisma');
  const settings = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { tmdbApiKey: true },
  });
  const key = normalizeTmdbApiKey(settings?.tmdbApiKey);
  if (key) return key;
  return normalizeTmdbApiKey(getTmdbApiKey());
}

/** TMDB v3 API keys are 32-char hex; strip accidental whitespace or pasted blobs. */
export function normalizeTmdbApiKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed;
  if (firstLine.length > 64) return null;
  return firstLine;
}

/** Verify key against TMDB /configuration (lightweight). */
export async function validateTmdbApiKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
  const key = normalizeTmdbApiKey(apiKey);
  if (!key) {
    return {
      valid: false,
      message:
        'Invalid TMDB API key format. Paste only the 32-character v3 API Key from themoviedb.org/settings/api (not the Read Access Token or full page text).',
    };
  }
  try {
    await tmdbFetch<{ success?: boolean }>('/configuration', key);
    return { valid: true, message: 'TMDB API key is valid' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('401')) {
      return { valid: false, message: 'TMDB rejected this API key (401). Check the v3 API Key value in TMDB settings.' };
    }
    return { valid: false, message: msg };
  }
}

export async function tmdbFetch<T>(path: string, apiKey: string): Promise<T> {
  const url = new URL(`${TMDB_API_BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  // A slow TMDB must not hold a request (or startup sync) open forever.
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TMDB request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Fetch a TMDB collection (release order of parts as returned by API).
 * MCU collection id is commonly 86311.
 */
export async function fetchTmdbCollection(
  collectionId: number,
  apiKey?: string,
): Promise<TmdbCollectionDetails> {
  const key = apiKey ?? (await getTmdbApiKeyFromSettings());
  if (!key) {
    throw new Error(
      'TMDB API key is not configured. Set TMDB_API_KEY or save tmdbApiKey in Settings.',
    );
  }

  const data = await tmdbFetch<{
    id: number;
    name: string;
    overview?: string;
    parts?: TmdbCollectionPart[];
  }>(`/collection/${collectionId}`, key);

  const parts = [...(data.parts ?? [])].sort((a, b) => {
    const da = a.release_date ? Date.parse(a.release_date) : 0;
    const db = b.release_date ? Date.parse(b.release_date) : 0;
    return da - db;
  });

  return {
    id: data.id,
    name: data.name,
    overview: data.overview,
    parts,
  };
}

export type TmdbMovieSummary = {
  id: number;
  title: string;
  release_date?: string;
};

/**
 * Search TMDB for a movie title (first result). Used when listings lookup misses.
 */
export type TmdbCollectionSearchResult = {
  id: number;
  name: string;
  overview?: string;
  poster_path?: string | null;
};

/** Search TMDB collections by name (e.g. "Marvel Cinematic Universe"). */
export async function searchTmdbCollections(
  query: string,
  apiKey?: string,
): Promise<TmdbCollectionSearchResult[]> {
  const key = apiKey ?? (await getTmdbApiKeyFromSettings());
  if (!key) {
    throw new Error(
      'TMDB API key is not configured. Set TMDB_API_KEY or save tmdbApiKey in Settings.',
    );
  }

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const path = `/search/collection?query=${encodeURIComponent(trimmed)}`;
  const data = await tmdbFetch<{
    results?: Array<{
      id: number;
      name: string;
      overview?: string;
      poster_path?: string | null;
    }>;
  }>(path, key);

  return (data.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    overview: row.overview,
    poster_path: row.poster_path,
  }));
}

export async function searchTmdbMovie(
  title: string,
  year?: number | null,
  apiKey?: string,
): Promise<TmdbMovieSummary | null> {
  const key = apiKey ?? (await getTmdbApiKeyFromSettings());
  if (!key) return null;

  const url = new URL(`${TMDB_API_BASE}/search/movie`);
  url.searchParams.set('api_key', key);
  url.searchParams.set('query', title);
  if (year) url.searchParams.set('year', String(year));

  const response = await fetch(url.toString());
  if (!response.ok) return null;

  const data = (await response.json()) as {
    results?: Array<{ id: number; title: string; release_date?: string }>;
  };
  const first = data.results?.[0];
  if (!first) return null;
  return { id: first.id, title: first.title, release_date: first.release_date };
}

async function requireKey(apiKey?: string): Promise<string> {
  const key = apiKey ?? (await getTmdbApiKeyFromSettings());
  if (!key) {
    throw new Error('TMDB API key is not configured. Set TMDB_API_KEY or save tmdbApiKey in Settings.');
  }
  return key;
}

export type TmdbKeywordResult = { id: number; name: string };

/** Search TMDB keywords (e.g. "marvel cinematic universe (mcu)"). */
export async function searchTmdbKeywords(query: string, apiKey?: string): Promise<TmdbKeywordResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const key = await requireKey(apiKey);
  const data = await tmdbFetch<{ results?: Array<{ id: number; name: string }> }>(
    `/search/keyword?query=${encodeURIComponent(trimmed)}`,
    key,
  );
  return (data.results ?? []).slice(0, 15).map((row) => ({ id: row.id, name: row.name }));
}

export type TmdbTitleRow = {
  id: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  overview: string | null;
};

type DiscoverMovie = { id: number; title: string; release_date?: string; poster_path?: string | null; overview?: string };
type DiscoverTv = { id: number; name: string; first_air_date?: string; poster_path?: string | null; overview?: string };

/** Movies tagged with a TMDB keyword (first 2 pages, most popular first). */
export async function fetchTmdbKeywordMovies(keywordId: number, apiKey?: string): Promise<TmdbTitleRow[]> {
  const key = await requireKey(apiKey);
  const rows: TmdbTitleRow[] = [];
  for (let page = 1; page <= 2; page++) {
    const data = await tmdbFetch<{ results?: DiscoverMovie[]; total_pages?: number }>(
      `/discover/movie?with_keywords=${keywordId}&sort_by=popularity.desc&page=${page}`,
      key,
    );
    for (const r of data.results ?? []) {
      rows.push({
        id: r.id,
        title: r.title,
        releaseDate: r.release_date || null,
        posterPath: r.poster_path ?? null,
        overview: r.overview ?? null,
      });
    }
    if (page >= (data.total_pages ?? 1)) break;
  }
  return rows;
}

/** TV shows tagged with a TMDB keyword (first page). */
export async function fetchTmdbKeywordShows(keywordId: number, apiKey?: string): Promise<TmdbTitleRow[]> {
  const key = await requireKey(apiKey);
  const data = await tmdbFetch<{ results?: DiscoverTv[] }>(
    `/discover/tv?with_keywords=${keywordId}&sort_by=popularity.desc`,
    key,
  );
  return (data.results ?? []).map((r) => ({
    id: r.id,
    title: r.name,
    releaseDate: r.first_air_date || null,
    posterPath: r.poster_path ?? null,
    overview: r.overview ?? null,
  }));
}

/** Search TMDB TV shows by name, optionally narrowed by first-air year. Returns the best matches. */
export async function searchTmdbTv(title: string, year?: number | null, apiKey?: string): Promise<TmdbTitleRow[]> {
  const key = await requireKey(apiKey);
  const yearPart = year ? `&first_air_date_year=${year}` : '';
  const data = await tmdbFetch<{ results?: DiscoverTv[] }>(
    `/search/tv?query=${encodeURIComponent(title)}${yearPart}`,
    key,
  );
  return (data.results ?? []).slice(0, 8).map((r) => ({
    id: r.id,
    title: r.name,
    releaseDate: r.first_air_date || null,
    posterPath: r.poster_path ?? null,
    overview: r.overview ?? null,
  }));
}

/** Search TMDB movies by name. Returns up to 8 matches (searchTmdbMovie returns only the first). */
export async function searchTmdbMovies(title: string, year?: number | null, apiKey?: string): Promise<TmdbTitleRow[]> {
  const key = await requireKey(apiKey);
  const yearPart = year ? `&year=${year}` : '';
  const data = await tmdbFetch<{ results?: DiscoverMovie[] }>(
    `/search/movie?query=${encodeURIComponent(title)}${yearPart}`,
    key,
  );
  return (data.results ?? []).slice(0, 8).map((r) => ({
    id: r.id,
    title: r.title,
    releaseDate: r.release_date || null,
    posterPath: r.poster_path ?? null,
    overview: r.overview ?? null,
  }));
}

export type TmdbTvDetails = {
  id: number;
  name: string;
  firstAirDate: string | null;
  posterPath: string | null;
  overview: string | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number; airDate: string | null }>;
};

export async function fetchTmdbTv(tvId: number, apiKey?: string): Promise<TmdbTvDetails> {
  const key = await requireKey(apiKey);
  const data = await tmdbFetch<{
    id: number;
    name: string;
    first_air_date?: string;
    poster_path?: string | null;
    overview?: string;
    seasons?: Array<{ season_number: number; episode_count: number; air_date?: string | null }>;
  }>(`/tv/${tvId}`, key);
  return {
    id: data.id,
    name: data.name,
    firstAirDate: data.first_air_date || null,
    posterPath: data.poster_path ?? null,
    overview: data.overview ?? null,
    seasons: (data.seasons ?? []).map((s) => ({
      seasonNumber: s.season_number,
      episodeCount: s.episode_count,
      airDate: s.air_date ?? null,
    })),
  };
}
