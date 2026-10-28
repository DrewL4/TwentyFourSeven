import { prisma } from './prisma';
import {
  applyFranchiseSortToChannel,
  franchiseSortMethodForSlug,
  parseFranchiseSlugFromSortMethod,
} from './franchise-sort-service';
import { LEGACY_TIMELINE_SORT_ALIASES } from './franchise-legacy-sort';
import { normalizeTitle } from './title-normalize';
import { prepareEntry, prepareMovie, scorePrepared } from './franchise-title-match';
import {
  fetchTmdbCollection,
  fetchTmdbKeywordMovies,
  fetchTmdbKeywordShows,
  searchTmdbMovies,
  searchTmdbTv,
} from './tmdb-service';
import { buildFranchiseCandidates, type TmdbPort, type FranchiseCandidate } from './franchise-candidates';
import { mergeFranchiseOrder, orderEntries, type OrderMode } from './franchise-order';
import { findStoryListForSource, getStoryList, type StoryList } from './franchise-story-lists';

export type ResolvedFranchiseOrderEntry = {
  position: number;
  label: string;
  tmdbId: number | null;
  titlePattern: string;
  releaseDateMs: number | null;
};

function parseReleaseMs(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? null : ms;
}

export function createTmdbPort(): TmdbPort {
  const rows = (list: Array<{ id: number; title: string; releaseDate: string | null; posterPath: string | null }>) =>
    list.map((r) => ({ id: r.id, title: r.title, releaseDate: r.releaseDate, posterPath: r.posterPath }));
  return {
    async collectionParts(id) {
      const c = await fetchTmdbCollection(id);
      return c.parts.map((p) => ({
        id: p.id,
        title: p.title,
        releaseDate: p.release_date || null,
        posterPath: p.poster_path ?? null,
      }));
    },
    async keywordMovies(id) {
      return rows(await fetchTmdbKeywordMovies(id));
    },
    async keywordShows(id) {
      return rows(await fetchTmdbKeywordShows(id));
    },
    async searchMovies(title, year) {
      return rows(await searchTmdbMovies(title, year));
    },
    async searchShows(title, year) {
      return rows(await searchTmdbTv(title, year));
    },
  };
}

/** The story list a franchise uses: the one it chose, or the one its slug/collection belongs to. */
export function storyListForFranchise(f: {
  slug: string;
  storyListKey: string | null;
  tmdbCollectionId: number | null;
}): StoryList | null {
  return getStoryList(f.storyListKey) ?? findStoryListForSource({ slug: f.slug, tmdbCollectionId: f.tmdbCollectionId });
}

function candidateData(c: FranchiseCandidate) {
  return {
    kind: c.kind,
    entryKey: c.entryKey,
    label: c.label,
    tmdbId: c.tmdbId,
    titlePattern: c.titlePattern,
    seasonNumber: c.seasonNumber,
    episodeStart: c.episodeStart,
    episodeEnd: c.episodeEnd,
    releaseDate: c.releaseDate ? new Date(c.releaseDate) : null,
    posterPath: c.posterPath,
    storyIndex: c.storyIndex,
  };
}

function validDate<T extends { releaseDate: Date | null }>(row: T): T {
  if (row.releaseDate && Number.isNaN(row.releaseDate.getTime())) return { ...row, releaseDate: null };
  return row;
}

const MOVIE_LINK_MIN_SCORE = 800;

async function linkEntriesToLibraryMovies(franchiseId: string): Promise<number> {
  const entries = await prisma.franchiseEntry.findMany({
    where: { franchiseId, kind: 'MOVIE', excluded: false },
    select: { id: true, tmdbId: true, titlePattern: true, label: true, movieId: true },
  });
  if (entries.length === 0) return 0;

  const tmdbIds = entries.map((e) => e.tmdbId).filter((id): id is number => id != null);
  const movies = await prisma.mediaMovie.findMany({
    where: tmdbIds.length > 0 ? { OR: [{ tmdbId: { in: tmdbIds } }, { tmdbId: null }] } : {},
    select: { id: true, tmdbId: true, title: true, year: true },
  });

  // Normalize each title once (not once per entry x movie): a library of tens of thousands of
  // movies against dozens of entries used to cost millions of regex passes and block the server.
  const preparedMovies = movies.map((m) => ({ id: m.id, prepared: prepareMovie(m) }));
  const pairs: Array<{ entryId: string; movieId: string; score: number }> = [];
  for (const entry of entries) {
    const prepared = prepareEntry({ ...entry, movieId: undefined });
    for (const movie of preparedMovies) {
      const score = scorePrepared(movie.prepared, prepared);
      if (score > 0) pairs.push({ entryId: entry.id, movieId: movie.id, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedEntries = new Set<string>();
  const usedMovies = new Set<string>();
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  let changedLinks = 0;
  for (const pair of pairs) {
    if (usedEntries.has(pair.entryId) || usedMovies.has(pair.movieId)) continue;
    if (pair.score < MOVIE_LINK_MIN_SCORE) continue;
    usedEntries.add(pair.entryId);
    usedMovies.add(pair.movieId);
    if (byEntry.get(pair.entryId)?.movieId === pair.movieId) continue;
    await prisma.franchiseEntry.update({ where: { id: pair.entryId }, data: { movieId: pair.movieId } });
    changedLinks += 1;
  }
  // A movie that left the library un-links its entry (the entry itself stays, as "missing").
  for (const entry of entries) {
    if (entry.movieId && !usedEntries.has(entry.id)) {
      await prisma.franchiseEntry.update({ where: { id: entry.id }, data: { movieId: null } });
      changedLinks += 1;
    }
  }
  return changedLinks;
}

/**
 * Link show, season and episode-range entries to library shows by title. MediaShow has no TMDB id,
 * so the match is by normalized title; when two library shows share a title the one whose year is
 * closest to (and not after) the entry's release year wins.
 */
export function pickLibraryShow(
  shows: ReadonlyArray<{ id: string; title: string; year: number | null }>,
  titlePattern: string,
  releaseYear: number | null,
): string | null {
  const same = shows.filter((s) => normalizeTitle(s.title) === titlePattern);
  if (same.length === 0) return null;
  if (same.length === 1 || releaseYear == null) return same[0].id;
  const scored = same
    .map((s) => ({ s, gap: s.year == null ? 1000 : releaseYear - s.year }))
    .sort((a, b) => (a.gap < 0 ? 5000 : a.gap) - (b.gap < 0 ? 5000 : b.gap));
  return scored[0].s.id;
}

async function linkEntriesToLibraryShows(franchiseId: string): Promise<number> {
  const entries = await prisma.franchiseEntry.findMany({
    where: { franchiseId, kind: { not: 'MOVIE' }, excluded: false },
    select: { id: true, titlePattern: true, releaseDate: true, showId: true },
  });
  if (entries.length === 0) return 0;
  const shows = await prisma.mediaShow.findMany({ select: { id: true, title: true, year: true } });
  let changedLinks = 0;
  for (const entry of entries) {
    const year = entry.releaseDate ? entry.releaseDate.getUTCFullYear() : null;
    const showId = entry.titlePattern ? pickLibraryShow(shows, entry.titlePattern, year) : null;
    if (showId !== entry.showId) {
      await prisma.franchiseEntry.update({ where: { id: entry.id }, data: { showId } });
      changedLinks += 1;
    }
  }
  return changedLinks;
}

/**
 * Merge the freshly built list into the saved entries. Hand edits (added, removed, re-ordered
 * entries) are kept; only entries that came from the source and left it are removed.
 */
async function mergeEntries(
  franchiseId: string,
  mode: OrderMode,
  customOrder: boolean,
  candidates: FranchiseCandidate[],
): Promise<{ entryCount: number; changed: boolean }> {
  const ordered = orderEntries(
    candidates.map((c) => ({ ...c, releaseDate: c.releaseDate })),
    mode,
  );
  const existing = await prisma.franchiseEntry.findMany({
    where: { franchiseId },
    orderBy: { position: 'asc' },
  });
  const plan = mergeFranchiseOrder(existing, ordered, { customOrder });

  const before = JSON.stringify(
    existing.filter((e) => !e.excluded).map((e) => [e.entryKey, e.position, e.label, e.tmdbId, e.storyIndex]),
  );

  await prisma.$transaction(async (tx) => {
    for (const row of plan.remove) await tx.franchiseEntry.delete({ where: { id: row.id } });
    const freshByRow = new Map(plan.update.map((u) => [u.row.id, u.fresh]));
    let position = 0;
    for (const item of plan.order) {
      if ('row' in item) {
        const fresh = freshByRow.get(item.row.id);
        // Hand-added rows keep their own details; matched rows get refreshed metadata only.
        const data = fresh && !item.row.manual ? validDate(candidateData(fresh)) : {};
        await tx.franchiseEntry.update({ where: { id: item.row.id }, data: { ...data, position: position++ } });
      } else {
        await tx.franchiseEntry.create({
          data: { franchiseId, ...validDate(candidateData(item.fresh)), position: position++, movieId: null },
        });
      }
    }
  });

  const after = await prisma.franchiseEntry.findMany({
    where: { franchiseId, excluded: false },
    orderBy: { position: 'asc' },
    select: { entryKey: true, position: true, label: true, tmdbId: true, storyIndex: true },
  });
  const changed =
    before !== JSON.stringify(after.map((e) => [e.entryKey, e.position, e.label, e.tmdbId, e.storyIndex]));
  return { entryCount: after.length, changed };
}

/**
 * Re-sort saved entries for a new order mode without any network call, using the story index
 * and release date each entry already stores. Hand-placed order is replaced (the editor warns).
 */
export async function reorderFranchiseEntries(franchiseId: string, mode: OrderMode): Promise<void> {
  const rows = await prisma.franchiseEntry.findMany({
    where: { franchiseId },
    orderBy: { position: 'asc' },
  });
  const live = rows.filter((r) => !r.excluded);
  const sorted = orderEntries(live, mode);
  await prisma.$transaction(async (tx) => {
    let position = 0;
    for (const row of sorted) await tx.franchiseEntry.update({ where: { id: row.id }, data: { position: position++ } });
    for (const row of rows.filter((r) => r.excluded)) {
      await tx.franchiseEntry.update({ where: { id: row.id }, data: { position: position++ } });
    }
  });
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
  linkedShows?: number;
  channelsResorted: number;
  changed: boolean;
  skipped?: string;
};

const SKIP = (slug: string, skipped: string): FranchiseSyncResult => ({
  slug,
  entryCount: 0,
  linkedMovies: 0,
  channelsResorted: 0,
  changed: false,
  skipped,
});

/**
 * Refresh a franchise from TMDB (collection, keyword) and its story list, merging into the
 * saved entries so hand edits survive. An empty or failed fetch never touches saved entries.
 */
export async function syncFranchise(slug: string, port: TmdbPort = createTmdbPort()): Promise<FranchiseSyncResult> {
  let franchise = await prisma.franchise.findUnique({ where: { slug } });
  if (!franchise) return SKIP(slug, 'not found');

  // Franchises seeded by older versions (MCU, Star Wars) take their matching curated list once.
  if (!franchise.storyListKey) {
    const legacy = findStoryListForSource({ slug: franchise.slug, tmdbCollectionId: null });
    if (legacy) {
      franchise = await prisma.franchise.update({ where: { id: franchise.id }, data: { storyListKey: legacy.key } });
    }
  }

  const storyList = storyListForFranchise(franchise);
  if (!franchise.tmdbCollectionId && !franchise.tmdbKeywordId && !franchise.storyListKey) {
    return SKIP(slug, 'no tmdbCollectionId, keyword or story list configured');
  }

  const existing = await prisma.franchiseEntry.findMany({
    where: { franchiseId: franchise.id },
    select: { kind: true, tmdbId: true, titlePattern: true, manual: true },
  });
  const knownIds = new Map<string, number>();
  for (const e of existing) {
    if (e.tmdbId != null && e.titlePattern) {
      knownIds.set(`${e.kind === 'MOVIE' ? 'movie' : 'tv'}:${e.titlePattern}`, e.tmdbId);
    }
  }

  let candidates: FranchiseCandidate[];
  try {
    candidates = await buildFranchiseCandidates(
      {
        tmdbCollectionId: franchise.tmdbCollectionId,
        tmdbKeywordId: franchise.tmdbKeywordId,
        includeShows: franchise.includeShows,
        storyList,
        addListItems: !!franchise.storyListKey,
        knownIds,
      },
      port,
    );
  } catch (error) {
    console.error(`[franchise-sync] build failed for ${slug}:`, error);
    return SKIP(slug, 'sync failed');
  }
  if (candidates.length === 0) return SKIP(slug, 'empty result (kept saved entries)');

  const { entryCount, changed } = await mergeEntries(
    franchise.id,
    franchise.sortMode as OrderMode,
    franchise.customOrder,
    candidates,
  );
  const linkedMovies = await linkEntriesToLibraryMovies(franchise.id);
  const linkedShows = franchise.includeShows ? await linkEntriesToLibraryShows(franchise.id) : 0;

  await prisma.franchise.update({ where: { id: franchise.id }, data: { lastSyncedAt: new Date() } });

  let channelsResorted = 0;
  if (changed || linkedMovies > 0 || linkedShows > 0) {
    channelsResorted = await resortChannelsUsingFranchise(slug);
  }
  console.info(
    `[franchise-sync] ${slug}: ${entryCount} entries, ${linkedMovies} movie links, ${linkedShows} show links, ${channelsResorted} channels re-sorted`,
  );
  return { slug, entryCount, linkedMovies, linkedShows, channelsResorted, changed };
}

/** Link library movies and shows to a franchise's saved entries, no TMDB call (used after edits). */
export async function relinkFranchise(franchiseId: string): Promise<void> {
  const f = await prisma.franchise.findUnique({ where: { id: franchiseId }, select: { includeShows: true } });
  await linkEntriesToLibraryMovies(franchiseId);
  if (f?.includeShows) await linkEntriesToLibraryShows(franchiseId);
}

/** @deprecated Use syncFranchise */
export const syncBuiltinFranchise = syncFranchise;

export async function syncAllFranchises(): Promise<FranchiseSyncResult[]> {
  const franchises = await prisma.franchise.findMany({
    where: {
      OR: [
        { tmdbCollectionId: { not: null } },
        { tmdbKeywordId: { not: null } },
        { storyListKey: { not: null } },
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

export function parseFranchiseSlugFromChannelSort(autoSortMethod: string | null | undefined): string | null {
  if (!autoSortMethod) return null;
  return parseFranchiseSlugFromSortMethod(autoSortMethod);
}
