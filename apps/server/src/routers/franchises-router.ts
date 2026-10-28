import { z } from 'zod';
import { ORPCError } from '@orpc/server';
import { managerProcedure, protectedProcedure } from '../lib/orpc';
import { prisma } from '../lib/prisma';
import { applyFranchiseToChannel } from '../lib/franchise-channel-service';
import {
  FRANCHISE_GROUP_TITLE,
  franchiseChannelName,
  nextFreeChannelNumber,
} from '../lib/franchise-channel-plan';
import {
  createTmdbPort,
  pickLibraryShow,
  relinkFranchise,
  reorderFranchiseEntries,
  storyListForFranchise,
  syncFranchise,
  syncAllFranchises,
} from '../lib/franchise-sync-service';
import { previewFranchiseSortForChannel } from '../lib/franchise-sort-service';
import {
  searchTmdbCollections,
  searchTmdbKeywords,
  searchTmdbMovies,
  searchTmdbTv,
} from '../lib/tmdb-service';
import { normalizeTitle } from '../lib/title-normalize';
import { findLibraryMovieForEntry } from '../lib/franchise-title-match';
import { buildFranchiseCandidates, type FranchiseCandidate } from '../lib/franchise-candidates';
import { entryKeyFor, entryLabelFor, orderEntries, type EntryKind, type OrderMode } from '../lib/franchise-order';
import { STORY_LISTS, getStoryList, findStoryListForSource } from '../lib/franchise-story-lists';
import {
  entryAvailability,
  requestItemForEntry,
  type EpisodeRef,
} from '../lib/franchise-availability';
import { sendWtRequest, WT_NO_TOKEN_MESSAGE, type WtRequestOutcome } from '../lib/wt-requests';
import { openWatchTowerToken } from '../lib/wt-user-token';
import { getEffectiveRole } from '../lib/admin-auth';
import { roleRank } from '../lib/wt-roles';

const orderModeSchema = z.enum(['CHRONOLOGICAL', 'RELEASE', 'RECOMMENDED']);
const kindSchema = z.enum(['MOVIE', 'SHOW', 'SEASON', 'EPISODES']);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function userIdOf(context: { session?: { user?: { id?: string } } | null }): string {
  const id = context.session?.user?.id;
  if (!id) throw new ORPCError('UNAUTHORIZED');
  return id;
}

/** Everyone may see every franchise. Only its owner, or a Manager/Admin, may change it. */
async function canEditFranchise(userId: string, franchise: { ownerId: string | null }): Promise<boolean> {
  if (franchise.ownerId && franchise.ownerId === userId) return true;
  return roleRank(await getEffectiveRole(userId, prisma)) >= roleRank('MANAGER');
}

async function loadEditable(userId: string, franchiseId: string) {
  const franchise = await prisma.franchise.findUnique({ where: { id: franchiseId } });
  if (!franchise) throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });
  if (!(await canEditFranchise(userId, franchise))) {
    throw new ORPCError('FORBIDDEN', { message: 'Only the person who made this franchise, or a manager, can change it.' });
  }
  return franchise;
}

type Source = { collectionId?: number | null; keywordId?: number | null; storyListKey?: string | null };

function requireSource(src: Source, hasManual = false) {
  if (!src.collectionId && !src.keywordId && !src.storyListKey && !hasManual) {
    throw new ORPCError('BAD_REQUEST', { message: 'Pick a TMDB collection, a keyword or a curated list.' });
  }
}

function tmdbMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'TMDB lookup failed';
}

const entrySelect = {
  id: true,
  position: true,
  kind: true,
  entryKey: true,
  label: true,
  tmdbId: true,
  seasonNumber: true,
  episodeStart: true,
  episodeEnd: true,
  releaseDate: true,
  posterPath: true,
  storyIndex: true,
  manual: true,
  excluded: true,
  requestedAt: true,
  wtRequestId: true,
  movieId: true,
  showId: true,
  movie: { select: { id: true, title: true, year: true, poster: true } },
  show: { select: { id: true, title: true, year: true, poster: true } },
} as const;

async function franchiseDetail(id: string, userId: string) {
  const franchise = await prisma.franchise.findUnique({
    where: { id },
    include: {
      entries: { orderBy: { position: 'asc' }, select: entrySelect },
      channels: { select: { id: true, name: true, number: true } },
    },
  });
  if (!franchise) throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });

  const showIds = [...new Set(franchise.entries.map((e) => e.showId).filter((s): s is string => !!s))];
  const episodes = showIds.length
    ? await prisma.mediaEpisode.findMany({
        where: { showId: { in: showIds } },
        select: { showId: true, seasonNumber: true, episodeNumber: true },
      })
    : [];
  const byShow = new Map<string, EpisodeRef[]>();
  for (const ep of episodes) {
    const list = byShow.get(ep.showId) ?? [];
    list.push({ seasonNumber: ep.seasonNumber, episodeNumber: ep.episodeNumber });
    byShow.set(ep.showId, list);
  }

  const owner = franchise.ownerId
    ? await prisma.user.findUnique({ where: { id: franchise.ownerId }, select: { name: true } })
    : null;

  const entries = franchise.entries.map((e) => {
    const a = entryAvailability(e, e.showId ? byShow.get(e.showId) : undefined);
    return { ...e, available: a.available, haveEpisodes: a.have, wantEpisodes: a.want };
  });
  const live = entries.filter((e) => !e.excluded);
  return {
    ...franchise,
    entries,
    ownerName: owner?.name ?? null,
    canEdit: await canEditFranchise(userId, franchise),
    entryCount: live.length,
    availableCount: live.filter((e) => e.available).length,
    missingCount: live.filter((e) => !e.available).length,
    storyListName: storyListForFranchise(franchise)?.name ?? null,
  };
}

const franchiseListSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  source: true,
  sortMode: true,
  tmdbCollectionId: true,
  tmdbKeywordId: true,
  storyListKey: true,
  includeShows: true,
  customOrder: true,
  ownerId: true,
  lastSyncedAt: true,
  channels: { select: { id: true } },
  entries: { where: { excluded: false }, select: { movieId: true, showId: true, kind: true } },
} as const;

const sourceInput = {
  tmdbCollectionId: z.number().int().positive().nullable().optional(),
  tmdbKeywordId: z.number().int().positive().nullable().optional(),
  storyListKey: z.string().nullable().optional(),
};

export const franchisesRouter = {
  /** Every signed-in user can see every franchise. */
  list: protectedProcedure.handler(async ({ context }) => {
    const userId = userIdOf(context);
    const manager = roleRank(await getEffectiveRole(userId, prisma)) >= roleRank('MANAGER');
    const franchises = await prisma.franchise.findMany({ orderBy: { name: 'asc' }, select: franchiseListSelect });
    return franchises.map((f) => {
      const inLibrary = f.entries.filter((e) => (e.kind === 'MOVIE' ? e.movieId : e.showId)).length;
      return {
        id: f.id,
        slug: f.slug,
        name: f.name,
        description: f.description,
        source: f.source,
        sortMode: f.sortMode,
        tmdbCollectionId: f.tmdbCollectionId,
        tmdbKeywordId: f.tmdbKeywordId,
        storyListKey: f.storyListKey,
        includeShows: f.includeShows,
        customOrder: f.customOrder,
        ownerId: f.ownerId,
        lastSyncedAt: f.lastSyncedAt,
        entryCount: f.entries.length,
        inLibraryCount: inLibrary,
        channelCount: f.channels.length,
        canEdit: manager || (!!f.ownerId && f.ownerId === userId),
      };
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().optional(), slug: z.string().optional() }))
    .handler(async ({ input, context }) => {
      if (!input.id && !input.slug) {
        throw new ORPCError('BAD_REQUEST', { message: 'id or slug required' });
      }
      const found = await prisma.franchise.findFirst({
        where: input.id ? { id: input.id } : { slug: input.slug },
        select: { id: true },
      });
      if (!found) throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });
      return franchiseDetail(found.id, userIdOf(context));
    }),

  /** Search TMDB collections and keywords, plus the curated story lists, in one go. */
  search: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2) }))
    .handler(async ({ input }) => {
      const needle = normalizeTitle(input.query);
      const storyLists = STORY_LISTS.filter((l) => normalizeTitle(l.name).includes(needle) || l.key.includes(needle)).map(
        (l) => ({ key: l.key, name: l.name, itemCount: l.items.length }),
      );
      const [collections, keywords] = await Promise.allSettled([
        searchTmdbCollections(input.query),
        searchTmdbKeywords(input.query),
      ]);
      const error =
        collections.status === 'rejected' && keywords.status === 'rejected' ? tmdbMessage(collections.reason) : null;
      return {
        storyLists,
        collections: collections.status === 'fulfilled' ? collections.value : [],
        keywords: keywords.status === 'fulfilled' ? keywords.value : [],
        error,
      };
    }),

  /** Search TMDB for one movie or show to add by hand (it may be missing from the library). */
  searchTitles: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2), includeShows: z.boolean().optional().default(false) }))
    .handler(async ({ input }) => {
      const [movies, shows] = await Promise.allSettled([
        searchTmdbMovies(input.query),
        input.includeShows ? searchTmdbTv(input.query) : Promise.resolve([]),
      ]);
      return {
        movies: movies.status === 'fulfilled' ? movies.value : [],
        shows: shows.status === 'fulfilled' ? shows.value : [],
        error: movies.status === 'rejected' ? tmdbMessage(movies.reason) : null,
      };
    }),

  /** Search what is in the library, to add to a franchise by hand. */
  searchLibrary: protectedProcedure
    .input(z.object({ query: z.string().trim().min(1), includeShows: z.boolean().optional().default(false) }))
    .handler(async ({ input }) => {
      const movies = await prisma.mediaMovie.findMany({
        where: { title: { contains: input.query } },
        select: { id: true, title: true, year: true, poster: true, tmdbId: true },
        orderBy: [{ title: 'asc' }],
        take: 25,
      });
      const shows = input.includeShows
        ? await prisma.mediaShow.findMany({
            where: { title: { contains: input.query } },
            select: { id: true, title: true, year: true, poster: true },
            orderBy: [{ title: 'asc' }],
            take: 25,
          })
        : [];
      return { movies, shows };
    }),

  /** What a franchise would contain, marked in-library or missing, before anything is saved. */
  preview: protectedProcedure
    .input(
      z.object({
        collectionId: z.number().int().positive().nullable().optional(),
        keywordId: z.number().int().positive().nullable().optional(),
        storyListKey: z.string().nullable().optional(),
        includeShows: z.boolean().optional().default(false),
        sortMode: orderModeSchema.optional().default('RECOMMENDED'),
      }),
    )
    .handler(async ({ input }) => {
      requireSource(input);
      const list = getStoryList(input.storyListKey) ?? findStoryListForSource({ slug: '', tmdbCollectionId: input.collectionId ?? null });
      let candidates: FranchiseCandidate[];
      try {
        candidates = await buildFranchiseCandidates(
          {
            tmdbCollectionId: input.collectionId ?? null,
            tmdbKeywordId: input.keywordId ?? null,
            includeShows: input.includeShows,
            storyList: list,
            addListItems: !!input.storyListKey,
            knownIds: new Map(),
          },
          createTmdbPort(),
        );
      } catch (error) {
        throw new ORPCError('BAD_REQUEST', { message: tmdbMessage(error) });
      }
      const ordered = orderEntries(candidates, input.sortMode as OrderMode);

      const [libraryMovies, libraryShows] = await Promise.all([
        prisma.mediaMovie.findMany({ select: { id: true, title: true, year: true, tmdbId: true } }),
        prisma.mediaShow.findMany({ select: { id: true, title: true, year: true } }),
      ]);
      const usedMovies = new Set<string>();
      const items = ordered.map((c) => {
        let inLibrary = false;
        let libraryTitle: string | null = null;
        if (c.kind === 'MOVIE') {
          const match = findLibraryMovieForEntry(
            { tmdbId: c.tmdbId, label: c.label, titlePattern: c.titlePattern },
            libraryMovies,
            usedMovies,
          );
          if (match) {
            usedMovies.add(match.id);
            inLibrary = true;
            libraryTitle = match.title;
          }
        } else {
          const year = c.releaseDate ? parseInt(c.releaseDate.slice(0, 4), 10) : null;
          const showId = pickLibraryShow(libraryShows, c.titlePattern, Number.isFinite(year) ? year : null);
          inLibrary = showId != null;
          libraryTitle = libraryShows.find((s) => s.id === showId)?.title ?? null;
        }
        return {
          entryKey: c.entryKey,
          kind: c.kind as EntryKind,
          label: c.label,
          tmdbId: c.tmdbId,
          seasonNumber: c.seasonNumber,
          episodeStart: c.episodeStart,
          episodeEnd: c.episodeEnd,
          releaseDate: c.releaseDate,
          posterPath: c.posterPath,
          storyIndex: c.storyIndex,
          inLibrary,
          libraryTitle,
        };
      });
      return {
        sortMode: input.sortMode,
        storyListName: list?.name ?? null,
        total: items.length,
        inLibraryCount: items.filter((i) => i.inLibrary).length,
        items,
      };
    }),

  /** Anyone signed in can create a franchise. It is visible to everyone; the creator owns it. */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(500).optional(),
        sortMode: orderModeSchema.optional().default('RECOMMENDED'),
        includeShows: z.boolean().optional().default(false),
        ...sourceInput,
        libraryMovieIds: z.array(z.string()).max(300).optional(),
        libraryShowIds: z.array(z.string()).max(100).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const userId = userIdOf(context);
      const hasManual = !!(input.libraryMovieIds?.length || input.libraryShowIds?.length);
      requireSource(
        { collectionId: input.tmdbCollectionId, keywordId: input.tmdbKeywordId, storyListKey: input.storyListKey },
        hasManual,
      );
      if (input.storyListKey && !getStoryList(input.storyListKey)) {
        throw new ORPCError('BAD_REQUEST', { message: 'Unknown curated list' });
      }
      let slug = slugify(input.name) || 'franchise';
      if (await prisma.franchise.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;

      const franchise = await prisma.franchise.create({
        data: {
          slug,
          name: input.name,
          description: input.description,
          source: 'CUSTOM',
          sortMode: input.sortMode,
          includeShows: input.includeShows,
          tmdbCollectionId: input.tmdbCollectionId ?? null,
          tmdbKeywordId: input.tmdbKeywordId ?? null,
          storyListKey: input.storyListKey ?? null,
          ownerId: userId,
        },
      });

      let syncNote: string | null = null;
      if (input.tmdbCollectionId || input.tmdbKeywordId || input.storyListKey) {
        const result = await syncFranchise(franchise.slug);
        if (result.skipped) syncNote = result.skipped;
      }
      for (const movieId of input.libraryMovieIds ?? []) {
        await addLibraryEntry(franchise.id, { kind: 'MOVIE', libraryMovieId: movieId });
      }
      if (input.includeShows) {
        for (const showId of input.libraryShowIds ?? []) {
          await addLibraryEntry(franchise.id, { kind: 'SHOW', libraryShowId: showId });
        }
      }
      if (hasManual) {
        await reorderFranchiseEntries(franchise.id, input.sortMode as OrderMode);
        await relinkFranchise(franchise.id);
      }
      return { ...(await franchiseDetail(franchise.id, userId)), syncNote };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        sortMode: orderModeSchema.optional(),
        includeShows: z.boolean().optional(),
        ...sourceInput,
      }),
    )
    .handler(async ({ input, context }) => {
      const userId = userIdOf(context);
      const franchise = await loadEditable(userId, input.id);
      if (input.storyListKey && !getStoryList(input.storyListKey)) {
        throw new ORPCError('BAD_REQUEST', { message: 'Unknown curated list' });
      }
      const modeChanged = input.sortMode !== undefined && input.sortMode !== franchise.sortMode;
      const showsChanged = input.includeShows !== undefined && input.includeShows !== franchise.includeShows;
      const sourceChanged =
        (input.tmdbCollectionId !== undefined && input.tmdbCollectionId !== franchise.tmdbCollectionId) ||
        (input.tmdbKeywordId !== undefined && input.tmdbKeywordId !== franchise.tmdbKeywordId) ||
        (input.storyListKey !== undefined && input.storyListKey !== franchise.storyListKey);

      await prisma.franchise.update({
        where: { id: franchise.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.sortMode !== undefined ? { sortMode: input.sortMode } : {}),
          ...(input.includeShows !== undefined ? { includeShows: input.includeShows } : {}),
          ...(input.tmdbCollectionId !== undefined ? { tmdbCollectionId: input.tmdbCollectionId } : {}),
          ...(input.tmdbKeywordId !== undefined ? { tmdbKeywordId: input.tmdbKeywordId } : {}),
          ...(input.storyListKey !== undefined ? { storyListKey: input.storyListKey } : {}),
          // Picking an order mode means "use this order": hand-placed order is dropped.
          ...(modeChanged ? { customOrder: false } : {}),
        },
      });

      let syncNote: string | null = null;
      if (showsChanged || sourceChanged) {
        const result = await syncFranchise(franchise.slug);
        if (result.skipped) syncNote = result.skipped;
      }
      if (modeChanged) {
        await reorderFranchiseEntries(franchise.id, input.sortMode as OrderMode);
        const { resortChannelsUsingFranchise } = await import('../lib/franchise-sync-service');
        await resortChannelsUsingFranchise(franchise.slug);
      }
      return { ...(await franchiseDetail(franchise.id, userId)), syncNote };
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    await loadEditable(userIdOf(context), input.id);
    await prisma.channel.updateMany({ where: { franchiseId: input.id }, data: { franchiseId: null } });
    await prisma.franchise.delete({ where: { id: input.id } });
    return { success: true };
  }),

  /** Add one entry by hand: from the library, or a TMDB title that is missing from it. */
  addEntry: protectedProcedure
    .input(
      z.object({
        franchiseId: z.string(),
        kind: kindSchema.optional().default('MOVIE'),
        libraryMovieId: z.string().optional(),
        libraryShowId: z.string().optional(),
        tmdbId: z.number().int().positive().optional(),
        title: z.string().trim().min(1).optional(),
        releaseDate: z.string().optional(),
        posterPath: z.string().nullable().optional(),
        seasonNumber: z.number().int().min(0).optional(),
        episodeStart: z.number().int().min(1).optional(),
        episodeEnd: z.number().int().min(1).optional(),
        afterEntryId: z.string().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const userId = userIdOf(context);
      const franchise = await loadEditable(userId, input.franchiseId);
      if (input.kind !== 'MOVIE' && !franchise.includeShows) {
        throw new ORPCError('BAD_REQUEST', { message: 'Turn on "Include TV shows" first.' });
      }
      const added = await addLibraryEntry(franchise.id, input);
      if (input.afterEntryId) {
        await placeAfter(franchise.id, added.id, input.afterEntryId);
        await prisma.franchise.update({ where: { id: franchise.id }, data: { customOrder: true } });
      } else if (!franchise.customOrder) {
        await reorderFranchiseEntries(franchise.id, franchise.sortMode as OrderMode);
      }
      await relinkFranchise(franchise.id);
      return franchiseDetail(franchise.id, userId);
    }),

  /** Hand-added entries are deleted; entries that came from the source are hidden so a sync keeps them out. */
  removeEntry: protectedProcedure.input(z.object({ entryId: z.string() })).handler(async ({ input, context }) => {
    const userId = userIdOf(context);
    const entry = await prisma.franchiseEntry.findUnique({ where: { id: input.entryId } });
    if (!entry) throw new ORPCError('NOT_FOUND', { message: 'Entry not found' });
    await loadEditable(userId, entry.franchiseId);
    if (entry.manual) await prisma.franchiseEntry.delete({ where: { id: entry.id } });
    else await prisma.franchiseEntry.update({ where: { id: entry.id }, data: { excluded: true } });
    return franchiseDetail(entry.franchiseId, userId);
  }),

  restoreEntry: protectedProcedure.input(z.object({ entryId: z.string() })).handler(async ({ input, context }) => {
    const userId = userIdOf(context);
    const entry = await prisma.franchiseEntry.findUnique({ where: { id: input.entryId } });
    if (!entry) throw new ORPCError('NOT_FOUND', { message: 'Entry not found' });
    const franchise = await loadEditable(userId, entry.franchiseId);
    await prisma.franchiseEntry.update({ where: { id: entry.id }, data: { excluded: false } });
    if (!franchise.customOrder) await reorderFranchiseEntries(franchise.id, franchise.sortMode as OrderMode);
    return franchiseDetail(entry.franchiseId, userId);
  }),

  /** Move one entry up or down. Saving a hand order keeps it through later syncs. */
  moveEntry: protectedProcedure
    .input(z.object({ entryId: z.string(), direction: z.enum(['up', 'down']) }))
    .handler(async ({ input, context }) => {
      const userId = userIdOf(context);
      const entry = await prisma.franchiseEntry.findUnique({ where: { id: input.entryId } });
      if (!entry) throw new ORPCError('NOT_FOUND', { message: 'Entry not found' });
      await loadEditable(userId, entry.franchiseId);
      const rows = await prisma.franchiseEntry.findMany({
        where: { franchiseId: entry.franchiseId },
        orderBy: { position: 'asc' },
        select: { id: true, excluded: true },
      });
      const live = rows.filter((r) => !r.excluded);
      const at = live.findIndex((r) => r.id === entry.id);
      const swap = input.direction === 'up' ? at - 1 : at + 1;
      if (at >= 0 && swap >= 0 && swap < live.length) {
        [live[at], live[swap]] = [live[swap], live[at]];
        const order = [...live, ...rows.filter((r) => r.excluded)];
        await prisma.$transaction([
          ...order.map((r, i) => prisma.franchiseEntry.update({ where: { id: r.id }, data: { position: i } })),
          prisma.franchise.update({ where: { id: entry.franchiseId }, data: { customOrder: true } }),
        ]);
      }
      return franchiseDetail(entry.franchiseId, userId);
    }),

  /** Drop the hand order and go back to the order mode. */
  resetOrder: protectedProcedure.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const userId = userIdOf(context);
    const franchise = await loadEditable(userId, input.id);
    await prisma.franchise.update({ where: { id: franchise.id }, data: { customOrder: false } });
    await reorderFranchiseEntries(franchise.id, franchise.sortMode as OrderMode);
    return franchiseDetail(franchise.id, userId);
  }),

  /** Re-check TMDB and the library for one franchise (owner or manager). */
  resync: protectedProcedure.input(z.object({ id: z.string() })).handler(async ({ input, context }) => {
    const userId = userIdOf(context);
    const franchise = await loadEditable(userId, input.id);
    const result = await syncFranchise(franchise.slug);
    await relinkFranchise(franchise.id);
    return { result, franchise: await franchiseDetail(franchise.id, userId) };
  }),

  /**
   * Ask WatchTower for missing titles, as the signed-in user, through WatchTower's own request
   * API. WatchTower decides approval exactly as it does for a request made in WatchTower.
   */
  requestMissing: protectedProcedure
    .input(
      z.object({
        franchiseId: z.string().optional(),
        /** Entries of that franchise to request. Omit to request everything missing. */
        entryIds: z.array(z.string()).max(60).optional(),
        /** Items from a preview that is not saved yet. */
        items: z
          .array(
            z.object({
              kind: kindSchema,
              label: z.string().min(1),
              tmdbId: z.number().int().positive().nullable(),
              seasonNumber: z.number().int().min(0).nullable().optional(),
              posterPath: z.string().nullable().optional(),
            }),
          )
          .max(60)
          .optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const userId = userIdOf(context);
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { watchTowerToken: true } });
      const token = openWatchTowerToken(user?.watchTowerToken ?? null);
      if (!token) throw new ORPCError('PRECONDITION_FAILED', { message: WT_NO_TOKEN_MESSAGE });
      const setting = await prisma.setting.findUnique({ where: { key: 'watchtower_url' } });
      const baseUrl = setting?.value?.trim();
      if (!baseUrl) throw new ORPCError('PRECONDITION_FAILED', { message: 'WatchTower is not set up on this server yet.' });

      type Target = {
        entryId: string | null;
        label: string;
        item: ReturnType<typeof requestItemForEntry>;
      };
      const targets: Target[] = [];
      if (input.franchiseId) {
        const detail = await franchiseDetail(input.franchiseId, userId);
        const wanted = input.entryIds ? new Set(input.entryIds) : null;
        for (const e of detail.entries) {
          if (e.excluded || e.available) continue;
          if (wanted && !wanted.has(e.id)) continue;
          targets.push({ entryId: e.id, label: e.label ?? 'Untitled', item: requestItemForEntry(e) });
        }
      }
      for (const it of input.items ?? []) {
        targets.push({
          entryId: null,
          label: it.label,
          item: requestItemForEntry({
            kind: it.kind,
            label: it.label,
            tmdbId: it.tmdbId,
            seasonNumber: it.seasonNumber ?? null,
            posterPath: it.posterPath ?? null,
          }),
        });
      }
      if (targets.length === 0) {
        throw new ORPCError('BAD_REQUEST', { message: 'Nothing to request.' });
      }

      const results: Array<{ entryId: string | null; label: string; outcome: WtRequestOutcome | { ok: false; status: 'unresolved'; message: string } }> = [];
      for (const t of targets) {
        if (!t.item) {
          results.push({
            entryId: t.entryId,
            label: t.label,
            outcome: { ok: false, status: 'unresolved', message: 'TMDB has no match for this title yet, so it cannot be requested.' },
          });
          continue;
        }
        const outcome = await sendWtRequest({ baseUrl, userToken: token, item: t.item });
        results.push({ entryId: t.entryId, label: t.label, outcome });
        if (t.entryId && (outcome.status === 'requested' || outcome.status === 'duplicate')) {
          await prisma.franchiseEntry.update({
            where: { id: t.entryId },
            data: { requestedAt: new Date(), wtRequestId: 'requestId' in outcome ? outcome.requestId : null },
          });
        }
        // Sign-in problems apply to every item: stop instead of repeating the failure.
        if (outcome.status === 'unauthorized' || outcome.status === 'unreachable') break;
      }
      const count = (s: string) => results.filter((r) => r.outcome.status === s).length;
      return {
        results,
        requested: count('requested'),
        alreadyRequested: count('duplicate'),
        failed: results.filter((r) => !['requested', 'duplicate'].includes(r.outcome.status)).length,
      };
    }),

  previewChannelSort: managerProcedure
    .input(z.object({ channelId: z.string(), franchiseSlug: z.string() }))
    .handler(async ({ input }) => {
      return previewFranchiseSortForChannel(input.channelId, input.franchiseSlug);
    }),

  /** Link channel to franchise: TMDB-based automation + timeline autoSortMethod */
  /**
   * One click: make a channel for a franchise (next free number from 100, grouped under
   * "Franchises", movies in watch order). If the franchise already has a channel, return it.
   */
  createChannel: managerProcedure
    .input(
      z.object({
        franchiseId: z.string(),
        number: z.number().int().positive().optional(),
        name: z.string().trim().min(1).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const franchise = await prisma.franchise.findUnique({ where: { id: input.franchiseId } });
      if (!franchise) {
        throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });
      }
      const existing = await prisma.channel.findFirst({
        where: { franchiseId: franchise.id },
        select: { id: true, number: true, name: true },
      });
      if (existing) {
        return { ...existing, created: false as const };
      }
      const entryCount = await prisma.franchiseEntry.count({ where: { franchiseId: franchise.id } });
      if (entryCount === 0) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'This franchise has no movies yet. Sync or edit it first, then create the channel.',
        });
      }
      const used = await prisma.channel.findMany({ select: { number: true } });
      const usedNumbers = used.map((c) => c.number);
      if (input.number !== undefined && usedNumbers.includes(input.number)) {
        throw new ORPCError('BAD_REQUEST', { message: `Channel ${input.number} is already taken` });
      }
      const number = input.number ?? nextFreeChannelNumber(usedNumbers);
      const name = input.name ?? franchiseChannelName(franchise.name);
      const channel = await prisma.channel.create({
        data: { number, name, groupTitle: FRANCHISE_GROUP_TITLE },
        select: { id: true, number: true, name: true },
      });
      await applyFranchiseToChannel(channel.id, franchise.id);
      try {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForChannel(channel.id, 24);
      } catch {
        // best-effort; the scheduler fills the guide on its next pass
      }
      return { ...channel, created: true as const };
    }),

  applyToChannel: managerProcedure
    .input(
      z.object({
        channelId: z.string(),
        franchiseId: z.string().optional(),
        franchiseSlug: z.string().optional(),
      }),
    )
    .handler(async ({ input }) => {
      if (!input.franchiseId && !input.franchiseSlug) {
        throw new ORPCError('BAD_REQUEST', { message: 'franchiseId or franchiseSlug required' });
      }
      const franchise = await prisma.franchise.findFirst({
        where: input.franchiseId ? { id: input.franchiseId } : { slug: input.franchiseSlug },
      });
      if (!franchise) {
        throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });
      }

      const link = await applyFranchiseToChannel(input.channelId, franchise.id);

      try {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForChannel(input.channelId, 24);
      } catch {
        // best-effort
      }

      return link;
    }),

  syncNow: managerProcedure
    .input(z.object({ slug: z.string().optional() }))
    .handler(async ({ input }) => {
      if (input.slug) {
        return syncFranchise(input.slug);
      }
      return syncAllFranchises();
    }),

  suggestFromCollection: managerProcedure
    .input(z.object({ collectionName: z.string().min(1) }))
    .handler(async ({ input }) => {
      const needle = input.collectionName.trim();
      const movies = await prisma.mediaMovie.findMany({
        where: { collections: { contains: `"${needle}"` } },
        select: { id: true, title: true, year: true, poster: true, tmdbId: true },
        orderBy: [{ year: 'asc' }, { title: 'asc' }],
      });
      return movies;
    }),
};

type AddInput = {
  kind: EntryKind;
  libraryMovieId?: string;
  libraryShowId?: string;
  tmdbId?: number;
  title?: string;
  releaseDate?: string;
  posterPath?: string | null;
  seasonNumber?: number;
  episodeStart?: number;
  episodeEnd?: number;
};

/** Add (or bring back) one hand-made entry. Returns the row. */
async function addLibraryEntry(franchiseId: string, input: AddInput) {
  let title = input.title ?? '';
  let year: number | null = input.releaseDate ? parseInt(input.releaseDate.slice(0, 4), 10) : null;
  let tmdbId = input.tmdbId ?? null;
  let poster = input.posterPath ?? null;
  let releaseDate = input.releaseDate ?? null;
  let movieId: string | null = null;
  let showId: string | null = null;

  if (input.kind === 'MOVIE') {
    if (input.libraryMovieId) {
      const movie = await prisma.mediaMovie.findUnique({ where: { id: input.libraryMovieId } });
      if (!movie) throw new ORPCError('NOT_FOUND', { message: 'That movie is not in the library.' });
      title = movie.title;
      year = movie.year ?? year;
      tmdbId = movie.tmdbId ?? tmdbId;
      movieId = movie.id;
      releaseDate = releaseDate ?? (movie.year ? `${movie.year}-01-01` : null);
    }
  } else {
    if (input.kind === 'SEASON' && input.seasonNumber == null) {
      throw new ORPCError('BAD_REQUEST', { message: 'Pick a season.' });
    }
    if (input.kind === 'EPISODES') {
      if (input.seasonNumber == null || !input.episodeStart || !input.episodeEnd || input.episodeStart > input.episodeEnd) {
        throw new ORPCError('BAD_REQUEST', { message: 'Pick a season and a first and last episode.' });
      }
    }
    if (input.libraryShowId) {
      const show = await prisma.mediaShow.findUnique({ where: { id: input.libraryShowId } });
      if (!show) throw new ORPCError('NOT_FOUND', { message: 'That show is not in the library.' });
      title = show.title;
      year = show.year ?? year;
      showId = show.id;
      releaseDate = releaseDate ?? (show.year ? `${show.year}-01-01` : null);
    }
  }
  if (!title) throw new ORPCError('BAD_REQUEST', { message: 'Pick something from the library or a TMDB result.' });

  const parts = {
    kind: input.kind,
    tmdbId,
    title,
    year,
    seasonNumber: input.kind === 'MOVIE' || input.kind === 'SHOW' ? null : (input.seasonNumber ?? null),
    episodeStart: input.kind === 'EPISODES' ? (input.episodeStart ?? null) : null,
    episodeEnd: input.kind === 'EPISODES' ? (input.episodeEnd ?? null) : null,
  };
  const entryKey = entryKeyFor(parts);
  const existing = await prisma.franchiseEntry.findFirst({ where: { franchiseId, entryKey } });
  if (existing) {
    if (existing.excluded) return prisma.franchiseEntry.update({ where: { id: existing.id }, data: { excluded: false } });
    return existing;
  }
  const last = await prisma.franchiseEntry.aggregate({ where: { franchiseId }, _max: { position: true } });
  const parsedDate = releaseDate ? new Date(releaseDate) : null;
  return prisma.franchiseEntry.create({
    data: {
      franchiseId,
      position: (last._max.position ?? -1) + 1,
      kind: input.kind,
      entryKey,
      label: entryLabelFor(parts),
      tmdbId,
      titlePattern: normalizeTitle(title),
      movieId,
      showId,
      seasonNumber: parts.seasonNumber,
      episodeStart: parts.episodeStart,
      episodeEnd: parts.episodeEnd,
      releaseDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
      posterPath: poster,
      manual: true,
    },
  });
}

async function placeAfter(franchiseId: string, entryId: string, afterId: string) {
  const rows = await prisma.franchiseEntry.findMany({
    where: { franchiseId },
    orderBy: { position: 'asc' },
    select: { id: true, excluded: true },
  });
  const live = rows.filter((r) => !r.excluded && r.id !== entryId);
  const at = live.findIndex((r) => r.id === afterId);
  live.splice(at >= 0 ? at + 1 : live.length, 0, { id: entryId, excluded: false });
  const order = [...live, ...rows.filter((r) => r.excluded)];
  await prisma.$transaction(order.map((r, i) => prisma.franchiseEntry.update({ where: { id: r.id }, data: { position: i } })));
}
