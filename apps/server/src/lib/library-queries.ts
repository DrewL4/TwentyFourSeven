import type { Prisma } from "../../prisma/generated/client";

export function buildShowWhere(input: {
  libraryId?: string;
  search?: string;
  collection?: string;
}): Prisma.MediaShowWhereInput {
  const where: Prisma.MediaShowWhereInput = {};
  if (input.libraryId) where.libraryId = input.libraryId;
  if (input.search) {
    where.title = { contains: input.search };
  }
  if (input.collection) {
    where.collections = { contains: `"${input.collection}"` };
  }
  return where;
}

export function buildMovieWhere(input: {
  libraryId?: string;
  search?: string;
  collection?: string;
}): Prisma.MediaMovieWhereInput {
  const where: Prisma.MediaMovieWhereInput = {};
  if (input.libraryId) where.libraryId = input.libraryId;
  if (input.search) {
    where.title = { contains: input.search };
  }
  if (input.collection) {
    where.collections = { contains: `"${input.collection}"` };
  }
  return where;
}

/** Grid/list row for library browse (no heavy metadata). */
export const libraryShowListSelect = {
  id: true,
  title: true,
  year: true,
  poster: true,
  library: { select: { id: true, name: true } },
  _count: { select: { episodes: true } },
} satisfies Prisma.MediaShowSelect;

export const libraryMovieListSelect = {
  id: true,
  title: true,
  year: true,
  poster: true,
  library: { select: { id: true, name: true } },
} satisfies Prisma.MediaMovieSelect;

export async function getCollectionCount(): Promise<number> {
  const { readCollectionsCacheIfFresh, buildCollectionsFromDb, writeCollectionsCache } =
    await import("./collections-cache");
  const cached = await readCollectionsCacheIfFresh();
  if (cached) {
    return cached.length;
  }
  const built = await buildCollectionsFromDb();
  await writeCollectionsCache(built);
  return built.length;
}
