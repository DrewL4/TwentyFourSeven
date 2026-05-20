import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { publicProcedure } from "../lib/orpc";
import { prisma } from "../lib/prisma";
import {
  buildCollectionsFromDb,
  readCollectionsCacheIfFresh,
  writeCollectionsCache,
} from "../lib/collections-cache";
import {
  buildMovieWhere,
  buildShowWhere,
  getCollectionCount,
  libraryMovieListSelect,
  libraryShowListSelect,
} from "../lib/library-queries";

const statsInputSchema = z.object({
  libraryId: z.string().optional(),
  search: z.string().optional(),
  collection: z.string().optional(),
});

export const libraryRouter = {
  stats: publicProcedure
    .input(statsInputSchema)
    .handler(async ({ input }) => {
      const showWhere = buildShowWhere(input);
      const movieWhere = buildMovieWhere(input);

      const [showCount, movieCount, episodeCount, libraryCount, serverCount, collectionCount] =
        await Promise.all([
          prisma.mediaShow.count({ where: showWhere }),
          prisma.mediaMovie.count({ where: movieWhere }),
          prisma.mediaEpisode.count({
            where: { show: showWhere },
          }),
          prisma.mediaLibrary.count(),
          prisma.mediaServer.count({
            where: { type: "PLEX", active: true },
          }),
          getCollectionCount(),
        ]);

      return {
        showCount,
        movieCount,
        episodeCount,
        libraryCount,
        serverCount,
        collectionCount,
      };
    }),

  debug: publicProcedure.handler(async () => {
    if (process.env.NODE_ENV === "production") {
      throw new ORPCError("NOT_FOUND", {
        message: "Library debug is disabled in production",
      });
    }

    const servers = await prisma.mediaServer.findMany({
      include: {
        libraries: {
          include: {
            shows: true,
            movies: true,
          },
        },
      },
    });

    const allLibraries = await prisma.mediaLibrary.findMany({
      include: {
        shows: true,
        movies: true,
        server: true,
      },
    });

    return {
      servers,
      libraries: allLibraries,
      counts: {
        servers: servers.length,
        libraries: allLibraries.length,
        shows: await prisma.mediaShow.count(),
        movies: await prisma.mediaMovie.count(),
      },
    };
  }),

  shows: publicProcedure
    .input(
      z.object({
        libraryId: z.string().optional(),
        search: z.string().optional(),
        collection: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
        includeEpisodes: z.boolean().optional().default(false),
      }),
    )
    .handler(async ({ input }) => {
      const where = buildShowWhere(input);
      const limit = Math.min(Math.max(input.limit, 1), 200);
      const skip = Math.max(input.offset, 0);

      if (input.includeEpisodes) {
        const [total, rows] = await prisma.$transaction([
          prisma.mediaShow.count({ where }),
          prisma.mediaShow.findMany({
            where,
            include: {
              library: true,
              episodes: {
                orderBy: [
                  { seasonNumber: "asc" },
                  { episodeNumber: "asc" },
                ],
              },
            },
            take: limit,
            skip,
            orderBy: { title: "asc" },
          }),
        ]);
        return { items: rows, total, limit, offset: skip };
      }

      const [total, rows] = await prisma.$transaction([
        prisma.mediaShow.count({ where }),
        prisma.mediaShow.findMany({
          where,
          select: libraryShowListSelect,
          take: limit,
          skip,
          orderBy: { title: "asc" },
        }),
      ]);

      return { items: rows, total, limit, offset: skip };
    }),

  movies: publicProcedure
    .input(
      z.object({
        libraryId: z.string().optional(),
        search: z.string().optional(),
        collection: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }),
    )
    .handler(async ({ input }) => {
      const where = buildMovieWhere(input);
      const limit = Math.min(Math.max(input.limit, 1), 200);
      const skip = Math.max(input.offset, 0);

      const [total, rows] = await prisma.$transaction([
        prisma.mediaMovie.count({ where }),
        prisma.mediaMovie.findMany({
          where,
          select: libraryMovieListSelect,
          take: limit,
          skip,
          orderBy: { title: "asc" },
        }),
      ]);

      return { items: rows, total, limit, offset: skip };
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string(),
        libraryId: z.string().optional(),
        collection: z.string().optional(),
        limit: z.number().default(40).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const q = input.query.trim();
      const lim = Math.min(Math.max(input.limit ?? 40, 1), 200);
      if (!q.length) {
        return { shows: [], movies: [], limit: lim };
      }
      const showWhere = buildShowWhere({
        libraryId: input.libraryId,
        search: q,
        collection: input.collection,
      });
      const movieWhere = buildMovieWhere({
        libraryId: input.libraryId,
        search: q,
        collection: input.collection,
      });

      const [shows, movies] = await Promise.all([
        prisma.mediaShow.findMany({
          where: showWhere,
          select: libraryShowListSelect,
          orderBy: { title: "asc" },
          take: lim,
        }),
        prisma.mediaMovie.findMany({
          where: movieWhere,
          select: libraryMovieListSelect,
          orderBy: { title: "asc" },
          take: lim,
        }),
      ]);
      return { shows, movies, limit: lim };
    }),

  episodes: publicProcedure
    .input(
      z.object({
        showId: z.string(),
        season: z.number().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const where: Record<string, unknown> = { showId: input.showId };
      if (input.season) where.seasonNumber = input.season;

      return prisma.mediaEpisode.findMany({
        where,
        include: { show: true },
        orderBy: [
          { seasonNumber: "asc" },
          { episodeNumber: "asc" },
        ],
      });
    }),

  collections: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      }),
    )
    .handler(async ({ input }) => {
      const { search = undefined, limit, offset } = input;

      const cached = await readCollectionsCacheIfFresh();
      let result = cached ?? (await buildCollectionsFromDb());
      if (!cached) {
        await writeCollectionsCache(result);
      }

      if (search) {
        const term = search.toLowerCase();
        result = result.filter((c) => c.name.toLowerCase().includes(term));
      }
      result.sort((a, b) => a.name.localeCompare(b.name));
      return result.slice(offset, offset + limit);
    }),

  showsByIds: publicProcedure
    .input(z.object({ ids: z.array(z.string()).max(500) }))
    .handler(async ({ input }) => {
      if (!input.ids.length) {
        return [];
      }
      return prisma.mediaShow.findMany({
        where: { id: { in: input.ids } },
        select: {
          id: true,
          title: true,
          poster: true,
          year: true,
          episodes: {
            orderBy: [
              { seasonNumber: "asc" },
              { episodeNumber: "asc" },
            ],
            select: {
              id: true,
              title: true,
              seasonNumber: true,
              episodeNumber: true,
              duration: true,
              thumb: true,
            },
          },
        },
        orderBy: { title: "asc" },
      });
    }),
} as const;
