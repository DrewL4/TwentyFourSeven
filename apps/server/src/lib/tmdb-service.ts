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

async function tmdbFetch<T>(path: string, apiKey: string): Promise<T> {
  const url = new URL(`${TMDB_API_BASE}${path}`);
  url.searchParams.set('api_key', apiKey);
  const response = await fetch(url.toString());
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
