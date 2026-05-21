import { z } from 'zod';
import { ORPCError } from '@orpc/server';
import { protectedProcedure } from '../lib/orpc';
import { prisma } from '../lib/prisma';
import { applyFranchiseToChannel } from '../lib/franchise-channel-service';
import { syncFranchise, syncAllFranchises } from '../lib/franchise-sync-service';
import { previewFranchiseSortForChannel } from '../lib/franchise-sort-service';
import { fetchTmdbCollection, searchTmdbCollections } from '../lib/tmdb-service';
import { sortCollectionPartsForWatchOrder } from '../lib/franchise-collection-order';
import {
  getSupplementsForCollection,
  mergeStorySupplements,
} from '../lib/franchise-story-supplements';
import { normalizeTitle } from '../lib/title-normalize';
import { findLibraryMovieForEntry } from '../lib/franchise-title-match';

const entryInputSchema = z.object({
  position: z.number().int().min(0),
  label: z.string().optional(),
  movieId: z.string().optional().nullable(),
  tmdbId: z.number().int().optional().nullable(),
  titlePattern: z.string().optional().nullable(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export const franchisesRouter = {
  list: protectedProcedure.handler(async () => {
    const franchises = await prisma.franchise.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { entries: true, channels: true } } },
    });
    return franchises.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      description: f.description,
      source: f.source,
      sortMode: f.sortMode,
      tmdbCollectionId: f.tmdbCollectionId,
      timelineUrl: f.timelineUrl,
      listingsUrl: f.listingsUrl,
      lastSyncedAt: f.lastSyncedAt,
      entryCount: f._count.entries,
      channelCount: f._count.channels,
    }));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().optional(), slug: z.string().optional() }))
    .handler(async ({ input }) => {
      if (!input.id && !input.slug) {
        throw new ORPCError('BAD_REQUEST', { message: 'id or slug required' });
      }
      const franchise = await prisma.franchise.findFirst({
        where: input.id ? { id: input.id } : { slug: input.slug },
        include: {
          entries: {
            orderBy: { position: 'asc' },
            include: {
              movie: {
                select: { id: true, title: true, year: true, poster: true, tmdbId: true },
              },
            },
          },
          channels: { select: { id: true, name: true, number: true } },
        },
      });
      if (!franchise) {
        throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });
      }
      return franchise;
    }),

  searchTmdbCollection: protectedProcedure
    .input(z.object({ query: z.string().min(2) }))
    .handler(async ({ input }) => searchTmdbCollections(input.query)),

  previewTmdbCollection: protectedProcedure
    .input(
      z.object({
        collectionId: z.number().int().positive(),
        sortMode: z.enum(['CHRONOLOGICAL', 'RELEASE']).optional().default('CHRONOLOGICAL'),
      }),
    )
    .handler(async ({ input }) => {
      const collection = await fetchTmdbCollection(input.collectionId);
      const parts = sortCollectionPartsForWatchOrder(collection.parts, input.sortMode);
      let previewRows = parts.map((part, position) => ({
        position,
        label: part.title,
        tmdbId: part.id,
        titlePattern: normalizeTitle(part.title),
        releaseDateMs: part.release_date ? Date.parse(part.release_date) : null,
      }));
      previewRows = mergeStorySupplements(
        previewRows,
        getSupplementsForCollection(input.collectionId),
        input.sortMode,
      );

      const libraryMovies = await prisma.mediaMovie.findMany({
        select: { id: true, title: true, year: true, tmdbId: true },
      });
      const usedMovieIds = new Set<string>();

      const partsWithLibrary = previewRows.map((p) => {
        const releaseYear =
          p.releaseDateMs != null
            ? new Date(p.releaseDateMs).getUTCFullYear()
            : null;
        const match = findLibraryMovieForEntry(
          {
            tmdbId: p.tmdbId,
            label: p.label,
            titlePattern: p.titlePattern,
          },
          libraryMovies,
          usedMovieIds,
        );
        if (match?.id) usedMovieIds.add(match.id);

        return {
          id: p.tmdbId ?? 0,
          title: p.label,
          release_date:
            p.releaseDateMs != null
              ? new Date(p.releaseDateMs).toISOString().slice(0, 10)
              : undefined,
          inLibrary: match != null,
          libraryTitle: match?.title ?? null,
        };
      });

      const inLibraryCount = partsWithLibrary.filter((p) => p.inLibrary).length;

      return {
        id: collection.id,
        name: collection.name,
        overview: collection.overview,
        partCount: partsWithLibrary.length,
        inLibraryCount,
        sortMode: input.sortMode,
        parts: partsWithLibrary,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().optional(),
        description: z.string().optional(),
        sortMode: z.enum(['CHRONOLOGICAL', 'RELEASE']).optional(),
        tmdbCollectionId: z.number().int().positive().optional(),
        timelineUrl: z.string().url().optional().or(z.literal('')),
        listingsUrl: z.string().url().optional().or(z.literal('')),
        entries: z.array(entryInputSchema).optional(),
        syncAfterCreate: z.boolean().optional().default(true),
      }),
    )
    .handler(async ({ input }) => {
      let slug = input.slug?.trim() || slugify(input.name);
      const existing = await prisma.franchise.findUnique({ where: { slug } });
      if (existing) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const franchise = await prisma.franchise.create({
        data: {
          slug,
          name: input.name,
          description: input.description,
          source: 'CUSTOM',
          sortMode: input.sortMode ?? 'CHRONOLOGICAL',
          tmdbCollectionId: input.tmdbCollectionId ?? null,
          timelineUrl: input.timelineUrl?.trim() || null,
          listingsUrl: input.listingsUrl?.trim() || null,
          entries: input.entries?.length
            ? {
                create: input.entries.map((e) => ({
                  position: e.position,
                  label: e.label,
                  movieId: e.movieId ?? null,
                  tmdbId: e.tmdbId ?? null,
                  titlePattern: e.titlePattern ?? null,
                })),
              }
            : undefined,
        },
        include: { entries: { orderBy: { position: 'asc' } } },
      });

      if (input.syncAfterCreate && (franchise.tmdbCollectionId || franchise.timelineUrl)) {
        await syncFranchise(franchise.slug);
        return prisma.franchise.findUnique({
          where: { id: franchise.id },
          include: { entries: { orderBy: { position: 'asc' } } },
        });
      }

      return franchise;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        sortMode: z.enum(['CHRONOLOGICAL', 'RELEASE']).optional(),
        tmdbCollectionId: z.number().int().positive().nullable().optional(),
        timelineUrl: z.string().url().nullable().optional().or(z.literal('')),
        listingsUrl: z.string().url().nullable().optional().or(z.literal('')),
        entries: z.array(entryInputSchema).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const franchise = await prisma.franchise.findUnique({ where: { id: input.id } });
      if (!franchise) {
        throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });
      }

      return prisma.$transaction(async (tx) => {
        if (input.entries) {
          await tx.franchiseEntry.deleteMany({ where: { franchiseId: input.id } });
          await tx.franchiseEntry.createMany({
            data: input.entries.map((e) => ({
              franchiseId: input.id,
              position: e.position,
              label: e.label ?? null,
              movieId: e.movieId ?? null,
              tmdbId: e.tmdbId ?? null,
              titlePattern: e.titlePattern ?? null,
            })),
          });
        }

        return tx.franchise.update({
          where: { id: input.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.sortMode !== undefined ? { sortMode: input.sortMode } : {}),
            ...(input.tmdbCollectionId !== undefined
              ? { tmdbCollectionId: input.tmdbCollectionId }
              : {}),
            ...(input.timelineUrl !== undefined
              ? { timelineUrl: input.timelineUrl?.trim() || null }
              : {}),
            ...(input.listingsUrl !== undefined
              ? { listingsUrl: input.listingsUrl?.trim() || null }
              : {}),
          },
          include: { entries: { orderBy: { position: 'asc' }, include: { movie: true } } },
        });
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async ({ input }) => {
      await prisma.channel.updateMany({
        where: { franchiseId: input.id },
        data: { franchiseId: null },
      });
      await prisma.franchise.delete({ where: { id: input.id } });
      return { success: true };
    }),

  previewChannelSort: protectedProcedure
    .input(z.object({ channelId: z.string(), franchiseSlug: z.string() }))
    .handler(async ({ input }) => {
      return previewFranchiseSortForChannel(input.channelId, input.franchiseSlug);
    }),

  /** Link channel to franchise: TMDB-based automation + timeline autoSortMethod */
  applyToChannel: protectedProcedure
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

  importFromTmdbCollection: protectedProcedure
    .input(
      z.object({
        collectionId: z.number().int().positive(),
        franchiseName: z.string().optional(),
        franchiseId: z.string().optional(),
        timelineUrl: z.string().url().optional().or(z.literal('')),
        listingsUrl: z.string().url().optional().or(z.literal('')),
        sortMode: z.enum(['CHRONOLOGICAL', 'RELEASE']).optional(),
        syncAfterImport: z.boolean().optional().default(true),
      }),
    )
    .handler(async ({ input }) => {
      const collection = await fetchTmdbCollection(input.collectionId);
      const sortMode = input.sortMode ?? 'CHRONOLOGICAL';

      if (input.franchiseId) {
        const existing = await prisma.franchise.findUnique({ where: { id: input.franchiseId } });
        if (!existing) {
          throw new ORPCError('NOT_FOUND', { message: 'Franchise not found' });
        }
        await prisma.franchise.update({
          where: { id: input.franchiseId },
          data: {
            tmdbCollectionId: input.collectionId,
            sortMode,
            ...(input.timelineUrl !== undefined
              ? { timelineUrl: input.timelineUrl?.trim() || null }
              : {}),
            ...(input.listingsUrl !== undefined
              ? { listingsUrl: input.listingsUrl?.trim() || null }
              : {}),
          },
        });
        if (input.syncAfterImport) {
          await syncFranchise(existing.slug);
        }
        return prisma.franchise.findUnique({
          where: { id: input.franchiseId },
          include: { entries: { orderBy: { position: 'asc' } } },
        });
      }

      const name = input.franchiseName ?? collection.name;
      let slug = slugify(name);
      const clash = await prisma.franchise.findUnique({ where: { slug } });
      if (clash) slug = `${slug}-${Date.now().toString(36)}`;

      const franchise = await prisma.franchise.create({
        data: {
          slug,
          name,
          description: collection.overview ?? `TMDB collection ${collection.id}`,
          source: 'CUSTOM',
          sortMode,
          tmdbCollectionId: input.collectionId,
          timelineUrl: input.timelineUrl?.trim() || null,
          listingsUrl: input.listingsUrl?.trim() || null,
        },
      });

      if (input.syncAfterImport) {
        await syncFranchise(franchise.slug);
      }

      return prisma.franchise.findUnique({
        where: { id: franchise.id },
        include: { entries: { orderBy: { position: 'asc' } } },
      });
    }),

  syncNow: protectedProcedure
    .input(z.object({ slug: z.string().optional() }))
    .handler(async ({ input }) => {
      if (input.slug) {
        return syncFranchise(input.slug);
      }
      return syncAllFranchises();
    }),

  suggestFromCollection: protectedProcedure
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
