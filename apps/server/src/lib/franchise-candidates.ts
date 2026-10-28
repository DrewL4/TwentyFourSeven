import { normalizeTitle } from './title-normalize';
import { inferStoryEpisodeOrder } from './franchise-collection-order';
import { entryKeyFor, entryLabelFor, type EntryKind } from './franchise-order';
import { titleMatchesStoryItem, type StoryItem, type StoryList } from './franchise-story-lists';

/**
 * Builds the list of things a franchise could contain, from TMDB (collection, keyword),
 * a hand-written story list, and the ids a franchise already resolved. The network is
 * behind `TmdbPort`, so tests run with a fake.
 */

export type TmdbRow = {
  id: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
};

export interface TmdbPort {
  collectionParts(collectionId: number): Promise<TmdbRow[]>;
  keywordMovies(keywordId: number): Promise<TmdbRow[]>;
  keywordShows(keywordId: number): Promise<TmdbRow[]>;
  searchMovies(title: string, year: number): Promise<TmdbRow[]>;
  searchShows(title: string, year: number): Promise<TmdbRow[]>;
}

export type FranchiseCandidate = {
  entryKey: string;
  kind: EntryKind;
  label: string;
  /** Normalized title of the movie, or of the show for SHOW/SEASON/EPISODES. */
  titlePattern: string;
  tmdbId: number | null;
  seasonNumber: number | null;
  episodeStart: number | null;
  episodeEnd: number | null;
  releaseDate: string | null;
  posterPath: string | null;
  storyIndex: number | null;
};

export type CandidateInput = {
  tmdbCollectionId: number | null;
  tmdbKeywordId: number | null;
  includeShows: boolean;
  /** The list whose order to use. */
  storyList: StoryList | null;
  /** True when the franchise chose the list as its source, so list items the library lacks are added too. */
  addListItems: boolean;
  /** `movie:<normalized title>` or `tv:<normalized title>` -> TMDB id, from rows this franchise already resolved (saves lookups). */
  knownIds: ReadonlyMap<string, number>;
};

function yearOf(date: string | null | undefined): number | null {
  const y = date ? parseInt(date.slice(0, 4), 10) : NaN;
  return Number.isFinite(y) ? y : null;
}

function movieCandidate(row: TmdbRow, storyIndex: number | null): FranchiseCandidate {
  return {
    entryKey: entryKeyFor({ kind: 'MOVIE', tmdbId: row.id, title: row.title, year: yearOf(row.releaseDate) }),
    kind: 'MOVIE',
    label: row.title,
    titlePattern: normalizeTitle(row.title),
    tmdbId: row.id,
    seasonNumber: null,
    episodeStart: null,
    episodeEnd: null,
    releaseDate: row.releaseDate || null,
    posterPath: row.posterPath,
    storyIndex,
  };
}

function showCandidate(
  item: Extract<StoryItem, { t: 'tv' | 'season' | 'eps' }>,
  tmdb: TmdbRow | null,
  storyIndex: number | null,
): FranchiseCandidate {
  const kind: EntryKind = item.t === 'tv' ? 'SHOW' : item.t === 'season' ? 'SEASON' : 'EPISODES';
  const parts = {
    kind,
    tmdbId: tmdb?.id ?? null,
    title: item.title,
    year: item.year,
    seasonNumber: item.t === 'tv' ? null : item.season,
    episodeStart: item.t === 'eps' ? item.from : null,
    episodeEnd: item.t === 'eps' ? item.to : null,
  };
  return {
    entryKey: entryKeyFor(parts),
    kind,
    label: entryLabelFor(parts),
    titlePattern: normalizeTitle(item.title),
    tmdbId: parts.tmdbId,
    seasonNumber: parts.seasonNumber,
    episodeStart: parts.episodeStart,
    episodeEnd: parts.episodeEnd,
    releaseDate: item.released,
    posterPath: tmdb?.posterPath ?? null,
    storyIndex,
  };
}

function pickMatch(rows: TmdbRow[], item: StoryItem): TmdbRow | null {
  return rows.find((r) => titleMatchesStoryItem(r.title, yearOf(r.releaseDate), item)) ?? null;
}

export async function buildFranchiseCandidates(input: CandidateInput, port: TmdbPort): Promise<FranchiseCandidate[]> {
  const movies = new Map<number, TmdbRow>();
  if (input.tmdbCollectionId != null) {
    for (const row of await port.collectionParts(input.tmdbCollectionId)) movies.set(row.id, row);
  }
  if (input.tmdbKeywordId != null) {
    for (const row of await port.keywordMovies(input.tmdbKeywordId)) if (!movies.has(row.id)) movies.set(row.id, row);
  }
  const keywordShows = new Map<number, TmdbRow>();
  if (input.includeShows && input.tmdbKeywordId != null) {
    for (const row of await port.keywordShows(input.tmdbKeywordId)) keywordShows.set(row.id, row);
  }

  const out = new Map<string, FranchiseCandidate>();
  const usedMovies = new Set<number>();
  const usedShows = new Set<number>();
  const add = (c: FranchiseCandidate) => {
    const existing = out.get(c.entryKey);
    if (!existing || (existing.storyIndex == null && c.storyIndex != null)) out.set(c.entryKey, c);
  };

  const list = input.storyList;
  if (list) {
    for (let idx = 0; idx < list.items.length; idx++) {
      const item = list.items[idx];
      if (item.t === 'movie') {
        const inPool = [...movies.values()].find(
          (r) => !usedMovies.has(r.id) && titleMatchesStoryItem(r.title, yearOf(r.releaseDate), item),
        );
        if (inPool) {
          usedMovies.add(inPool.id);
          add(movieCandidate(inPool, idx));
          continue;
        }
        if (!input.addListItems) continue;
        const known = input.knownIds.get(`movie:${normalizeTitle(item.title)}`);
        let row: TmdbRow | null = known != null ? { id: known, title: item.title, releaseDate: `${item.year}-01-01`, posterPath: null } : null;
        if (!row) {
          try {
            row = pickMatch(await port.searchMovies(item.title, item.year), item);
          } catch {
            row = null;
          }
        }
        if (row) {
          add(movieCandidate(row, idx));
        } else {
          add({
            ...movieCandidate({ id: 0, title: item.title, releaseDate: `${item.year}-01-01`, posterPath: null }, idx),
            entryKey: entryKeyFor({ kind: 'MOVIE', tmdbId: null, title: item.title, year: item.year }),
            tmdbId: null,
          });
        }
        continue;
      }

      // TV steps need "Include TV shows" and a list the franchise chose as its source.
      if (!input.includeShows || !input.addListItems) continue;
      const pooled = [...keywordShows.values()].find((r) => titleMatchesStoryItem(r.title, yearOf(r.releaseDate), item));
      let show: TmdbRow | null = pooled ?? null;
      if (pooled) usedShows.add(pooled.id);
      if (!show) {
        const known = input.knownIds.get(`tv:${normalizeTitle(item.title)}`);
        if (known != null) show = { id: known, title: item.title, releaseDate: `${item.year}-01-01`, posterPath: null };
      }
      if (!show) {
        try {
          show = pickMatch(await port.searchShows(item.title, item.year), item);
        } catch {
          show = null;
        }
      }
      add(showCandidate(item, show, idx));
    }
  }

  for (const row of movies.values()) {
    if (usedMovies.has(row.id)) continue;
    // Without a list, keep the old Star Wars style "Episode N" inference as the story hint.
    const inferred = list ? null : inferStoryEpisodeOrder(row.title, row.releaseDate ?? undefined);
    add(movieCandidate(row, inferred != null && inferred < 999 ? inferred : null));
  }
  for (const row of keywordShows.values()) {
    if (usedShows.has(row.id)) continue;
    add(
      showCandidate(
        { t: 'tv', title: row.title, year: yearOf(row.releaseDate) ?? 0, released: row.releaseDate ?? '' },
        row,
        null,
      ),
    );
  }
  return [...out.values()];
}
