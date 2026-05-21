import { prisma } from './prisma';
import {
  applyFranchiseSortToChannel,
  franchiseSortMethodForSlug,
  parseFranchiseSlugFromSortMethod,
} from './franchise-sort-service';
import { LEGACY_TIMELINE_SORT_ALIASES } from './franchise-legacy-sort';
import { normalizeTitle } from './title-normalize';
import { scoreTitleMatch } from './franchise-title-match';
import { fetchTmdbCollection, searchTmdbMovie } from './tmdb-service';
import {
  sortCollectionPartsForWatchOrder,
  type FranchiseSortMode,
} from './franchise-collection-order';
import {
  getSupplementsForCollection,
  mergeStorySupplements,
} from './franchise-story-supplements';

export type ResolvedFranchiseOrderEntry = {
  position: number;
  label: string;
  tmdbId: number | null;
  titlePattern: string;
  releaseDateMs: number | null;
};

type MarvelorderSheetRecord = {
  TYPE?: string | Record<string, unknown>;
  TITLE?: string;
  RELEASE_DATE?: string;
};

type ListingRecord = {
  id: number;
  title?: string;
  name?: string;
  original_name?: string;
};

type FranchiseSyncSource = {
  slug: string;
  tmdbCollectionId: number | null;
  timelineUrl: string | null;
  listingsUrl: string | null;
  sortMode: FranchiseSortMode;
};

let listingsIndexCache: Map<string, number> | null = null;
let listingsIndexFetchedAt = 0;
const LISTINGS_CACHE_MS = 6 * 60 * 60 * 1000;

function isMovieType(type: MarvelorderSheetRecord['TYPE']): boolean {
  if (type == null) return false;
  if (typeof type === 'string') return type.toUpperCase() === 'MOVIE';
  return false;
}

function parseReleaseMs(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? null : ms;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  if (!url?.trim()) return null;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      console.warn(`[franchise-sync] HTTP ${response.status} for ${url}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.warn(`[franchise-sync] Failed to fetch ${url}:`, error);
    return null;
  }
}

async function getListingsIndex(listingsUrl?: string | null): Promise<Map<string, number>> {
  const now = Date.now();
  if (listingsIndexCache && now - listingsIndexFetchedAt < LISTINGS_CACHE_MS) {
    return listingsIndexCache;
  }

  const map = new Map<string, number>();
  if (!listingsUrl?.trim()) {
    listingsIndexCache = map;
    listingsIndexFetchedAt = now;
    return map;
  }

  const listings = await fetchJson<ListingRecord[]>(listingsUrl);
  if (listings && Array.isArray(listings)) {
    for (const item of listings) {
      const keys = [item.title, item.name, item.original_name].filter(
        (k): k is string => typeof k === 'string' && k.trim().length > 0,
      );
      for (const key of keys) {
        map.set(normalizeTitle(key), item.id);
      }
    }
  }

  listingsIndexCache = map;
  listingsIndexFetchedAt = now;
  return map;
}

function resolveTmdbIdForTitle(
  title: string,
  listingsIndex: Map<string, number>,
): number | null {
  const norm = normalizeTitle(title);
  if (listingsIndex.has(norm)) return listingsIndex.get(norm)!;

  const withoutYear = norm.replace(/\s+\d{4}$/, '').trim();
  if (listingsIndex.has(withoutYear)) return listingsIndex.get(withoutYear)!;

  for (const [key, id] of listingsIndex.entries()) {
    if (key.includes(withoutYear) || withoutYear.includes(key)) {
      return id;
    }
  }
  return null;
}

async function resolveOrderFromTimelineUrl(
  source: FranchiseSyncSource,
): Promise<ResolvedFranchiseOrderEntry[]> {
  if (!source.timelineUrl?.trim()) return [];

  const sheet = await fetchJson<{ records?: MarvelorderSheetRecord[] }>(source.timelineUrl);
  if (!sheet?.records?.length) return [];

  const listingsIndex = await getListingsIndex(source.listingsUrl);
  const entries: ResolvedFranchiseOrderEntry[] = [];
  let position = 0;

  for (const record of sheet.records) {
    if (!isMovieType(record.TYPE)) continue;
    const title = record.TITLE?.trim();
    if (!title) continue;

    let tmdbId = resolveTmdbIdForTitle(title, listingsIndex);
    if (tmdbId == null) {
      const yearMatch = title.match(/\((\d{4})\)/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
      const cleanTitle = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      const searched = await searchTmdbMovie(cleanTitle, year);
      tmdbId = searched?.id ?? null;
    }

    entries.push({
      position: position++,
      label: title,
      tmdbId,
      titlePattern: normalizeTitle(title),
      releaseDateMs: parseReleaseMs(record.RELEASE_DATE),
    });
  }

  return entries;
}

async function resolveOrderFromTmdbCollection(
  collectionId: number,
  sortMode: FranchiseSortMode,
): Promise<ResolvedFranchiseOrderEntry[]> {
  const collection = await fetchTmdbCollection(collectionId);
  const parts = sortCollectionPartsForWatchOrder(collection.parts, sortMode);
  let ordered = parts.map((part, position) => ({
    position,
    label: part.title,
    tmdbId: part.id,
    titlePattern: normalizeTitle(part.title),
    releaseDateMs: parseReleaseMs(part.release_date),
  }));
  ordered = mergeStorySupplements(
    ordered,
    getSupplementsForCollection(collectionId),
    sortMode,
  );
  return ordered;
}

/**
 * Insert TMDB collection movies missing from the timeline using theatrical release date.
 */
export function mergeCollectionOrphans(
  ordered: ResolvedFranchiseOrderEntry[],
  parts: Array<{ id: number; title: string; release_date?: string }>,
): ResolvedFranchiseOrderEntry[] {
  const knownIds = new Set(
    ordered.map((e) => e.tmdbId).filter((id): id is number => id != null),
  );
  const orphans = parts
    .filter((p) => !knownIds.has(p.id))
    .map((p) => ({
      tmdbId: p.id,
      label: p.title,
      titlePattern: normalizeTitle(p.title),
      releaseDateMs: parseReleaseMs(p.release_date),
    }))
    .sort((a, b) => (a.releaseDateMs ?? 0) - (b.releaseDateMs ?? 0));

  if (orphans.length === 0) return ordered;

  const result = [...ordered];
  for (const orphan of orphans) {
    let insertAt = result.length;
    for (let i = 0; i < result.length; i++) {
      const entryMs = result[i].releaseDateMs;
      if (entryMs != null && orphan.releaseDateMs != null && orphan.releaseDateMs < entryMs) {
        insertAt = i;
        break;
      }
    }
    result.splice(insertAt, 0, {
      position: insertAt,
      label: orphan.label,
      tmdbId: orphan.tmdbId,
      titlePattern: orphan.titlePattern,
      releaseDateMs: orphan.releaseDateMs,
    });
    for (let i = 0; i < result.length; i++) {
      result[i].position = i;
    }
  }

  return result;
}

async function buildOrderForFranchise(
  source: FranchiseSyncSource,
): Promise<ResolvedFranchiseOrderEntry[]> {
  let ordered = await resolveOrderFromTimelineUrl(source);

  if (source.tmdbCollectionId) {
    try {
      const collection = await fetchTmdbCollection(source.tmdbCollectionId);
      if (ordered.length === 0) {
        ordered = await resolveOrderFromTmdbCollection(
          source.tmdbCollectionId,
          source.sortMode,
        );
      } else {
        const sortedParts = sortCollectionPartsForWatchOrder(
          collection.parts,
          source.sortMode,
        );
        ordered = mergeCollectionOrphans(ordered, sortedParts);
        for (const entry of ordered) {
          if (entry.tmdbId != null && entry.releaseDateMs == null) {
            const part = collection.parts.find((p) => p.id === entry.tmdbId);
            entry.releaseDateMs = parseReleaseMs(part?.release_date);
          }
        }
      }
    } catch (error) {
      console.warn(
        `[franchise-sync] TMDB collection ${source.tmdbCollectionId} skipped for ${source.slug}:`,
        error instanceof Error ? error.message : error,
      );
      if (ordered.length === 0) throw error;
    }
  }

  return ordered;
}

async function linkEntriesToLibraryMovies(franchiseId: string): Promise<number> {
  const entries = await prisma.franchiseEntry.findMany({
    where: { franchiseId },
    select: { id: true, tmdbId: true, titlePattern: true, label: true },
  });
  if (entries.length === 0) return 0;

  const tmdbIds = entries.map((e) => e.tmdbId).filter((id): id is number => id != null);
  const movies = await prisma.mediaMovie.findMany({
    where: tmdbIds.length > 0 ? { OR: [{ tmdbId: { in: tmdbIds } }, { tmdbId: null }] } : {},
    select: { id: true, tmdbId: true, title: true, year: true },
  });
  const movieByTmdb = new Map(
    movies.filter((m) => m.tmdbId != null).map((m) => [m.tmdbId!, m.id]),
  );

  const pairs: Array<{ entryId: string; movieId: string; score: number }> = [];
  for (const entry of entries) {
    for (const movie of movies) {
      const score = scoreTitleMatch(movie, entry);
      if (score > 0) {
        pairs.push({ entryId: entry.id, movieId: movie.id, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedEntries = new Set<string>();
  const usedMovies = new Set<string>();
  let linked = 0;

  for (const pair of pairs) {
    if (usedEntries.has(pair.entryId) || usedMovies.has(pair.movieId)) continue;
    if (pair.score < 800) continue;
    await prisma.franchiseEntry.update({
      where: { id: pair.entryId },
      data: { movieId: pair.movieId },
    });
    usedEntries.add(pair.entryId);
    usedMovies.add(pair.movieId);
    linked += 1;
  }

  return linked;
}

async function upsertFranchiseEntries(
  franchiseId: string,
  ordered: ResolvedFranchiseOrderEntry[],
): Promise<{ entryCount: number; changed: boolean }> {
  const existing = await prisma.franchiseEntry.findMany({
    where: { franchiseId },
    orderBy: { position: 'asc' },
    select: { tmdbId: true, titlePattern: true, position: true },
  });

  const signature = (rows: { tmdbId: number | null; titlePattern: string | null; position: number }[]) =>
    JSON.stringify(rows.map((r) => [r.position, r.tmdbId, r.titlePattern]));

  const nextRows = ordered.map((e, position) => ({
    position,
    tmdbId: e.tmdbId,
    titlePattern: e.titlePattern,
  }));

  const changed = signature(existing) !== signature(nextRows);

  await prisma.$transaction(async (tx) => {
    await tx.franchiseEntry.deleteMany({ where: { franchiseId } });
    if (ordered.length > 0) {
      await tx.franchiseEntry.createMany({
        data: ordered.map((e) => ({
          franchiseId,
          position: e.position,
          label: e.label,
          tmdbId: e.tmdbId,
          titlePattern: e.titlePattern,
          movieId: null,
        })),
      });
    }
  });

  return { entryCount: ordered.length, changed };
}

export async function resortChannelsUsingFranchise(slug: string): Promise<number> {
  const franchise = await prisma.franchise.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!franchise) return 0;

  const methods = new Set<string>([franchiseSortMethodForSlug(slug)]);
  for (const [legacy, mapped] of Object.entries(LEGACY_TIMELINE_SORT_ALIASES)) {
    if (mapped === slug) methods.add(legacy);
  }

  const channels = await prisma.channel.findMany({
    where: {
      OR: [
        { autoSortMethod: { in: [...methods] } },
        { franchiseId: franchise.id },
      ],
    },
    select: { id: true },
  });

  for (const channel of channels) {
    try {
      await applyFranchiseSortToChannel(channel.id, slug);
      const { programmingService } = await import('./programming-service');
      await programmingService.generateProgramsForChannel(channel.id, 24);
    } catch (error) {
      console.error(`[franchise-sync] Re-sort failed for channel ${channel.id}:`, error);
    }
  }

  return channels.length;
}

export type FranchiseSyncResult = {
  slug: string;
  entryCount: number;
  linkedMovies: number;
  channelsResorted: number;
  changed: boolean;
  skipped?: string;
};

/**
 * Refresh franchise watch order from DB-configured TMDB collection + optional timeline URL.
 */
export async function syncFranchise(slug: string): Promise<FranchiseSyncResult> {
  const franchise = await prisma.franchise.findUnique({ where: { slug } });
  if (!franchise) {
    return { slug, entryCount: 0, linkedMovies: 0, channelsResorted: 0, changed: false, skipped: 'not found' };
  }

  if (!franchise.tmdbCollectionId && !franchise.timelineUrl?.trim()) {
    return {
      slug,
      entryCount: 0,
      linkedMovies: 0,
      channelsResorted: 0,
      changed: false,
      skipped: 'no tmdbCollectionId or timelineUrl configured',
    };
  }

  const source: FranchiseSyncSource = {
    slug: franchise.slug,
    tmdbCollectionId: franchise.tmdbCollectionId,
    timelineUrl: franchise.timelineUrl,
    listingsUrl: franchise.listingsUrl,
    sortMode: franchise.sortMode,
  };

  let ordered: ResolvedFranchiseOrderEntry[];
  try {
    ordered = await buildOrderForFranchise(source);
  } catch (error) {
    console.error(`[franchise-sync] build order failed for ${slug}:`, error);
    return {
      slug,
      entryCount: 0,
      linkedMovies: 0,
      channelsResorted: 0,
      changed: false,
      skipped: 'sync failed',
    };
  }

  if (ordered.length === 0) {
    return {
      slug,
      entryCount: 0,
      linkedMovies: 0,
      channelsResorted: 0,
      changed: false,
      skipped: 'empty order',
    };
  }

  const { entryCount, changed } = await upsertFranchiseEntries(franchise.id, ordered);
  const linkedMovies = await linkEntriesToLibraryMovies(franchise.id);

  await prisma.franchise.update({
    where: { id: franchise.id },
    data: { lastSyncedAt: new Date() },
  });

  let channelsResorted = 0;
  if (changed || linkedMovies > 0) {
    channelsResorted = await resortChannelsUsingFranchise(slug);
  }

  console.info(
    `[franchise-sync] ${slug}: ${entryCount} entries, ${linkedMovies} linked, ${channelsResorted} channels re-sorted`,
  );

  return { slug, entryCount, linkedMovies, channelsResorted, changed };
}

/** @deprecated Use syncFranchise */
export const syncBuiltinFranchise = syncFranchise;

export async function syncAllFranchises(): Promise<FranchiseSyncResult[]> {
  const franchises = await prisma.franchise.findMany({
    where: {
      OR: [
        { tmdbCollectionId: { not: null } },
        { timelineUrl: { not: null } },
      ],
    },
    select: { slug: true },
  });

  const results: FranchiseSyncResult[] = [];
  for (const f of franchises) {
    results.push(await syncFranchise(f.slug));
  }
  return results;
}

/** @deprecated Use syncAllFranchises */
export const syncAllBuiltinFranchises = syncAllFranchises;

export async function onLibraryMovieUpdated(movieId: string): Promise<void> {
  const movie = await prisma.mediaMovie.findUnique({
    where: { id: movieId },
    select: { id: true, tmdbId: true },
  });
  if (!movie?.tmdbId) return;

  const franchises = await prisma.franchise.findMany({
    select: { id: true, slug: true },
  });

  for (const franchise of franchises) {
    const entry = await prisma.franchiseEntry.findFirst({
      where: { franchiseId: franchise.id, tmdbId: movie.tmdbId },
    });
    if (!entry) continue;

    await prisma.franchiseEntry.update({
      where: { id: entry.id },
      data: { movieId: movie.id },
    });

    const channels = await prisma.channel.findMany({
      where: {
        OR: [
          { franchiseId: franchise.id },
          {
            autoSortMethod: {
              in: [
                franchiseSortMethodForSlug(franchise.slug),
                ...Object.entries(LEGACY_TIMELINE_SORT_ALIASES)
                  .filter(([, s]) => s === franchise.slug)
                  .map(([legacy]) => legacy),
              ],
            },
          },
        ],
        channelMovies: { some: { movieId: movie.id } },
      },
      select: { id: true },
    });

    for (const ch of channels) {
      await applyFranchiseSortToChannel(ch.id, franchise.slug);
    }
  }
}

export function parseFranchiseSlugFromChannelSort(autoSortMethod: string | null | undefined): string | null {
  if (!autoSortMethod) return null;
  return parseFranchiseSlugFromSortMethod(autoSortMethod);
}
