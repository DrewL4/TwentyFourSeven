import { mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import path from "path";

const DEFAULT_PATH = path.join(
  process.cwd(),
  "static",
  "collections.cache.json",
);

const DEFAULT_TTL_MS = 60 * 60 * 1000;

export type CollectionStat = { name: string; count: number };

export function getCollectionsCachePath(): string {
  return process.env.COLLECTIONS_CACHE_PATH || DEFAULT_PATH;
}

export async function readCollectionsCacheIfFresh(
  maxAgeMs: number = DEFAULT_TTL_MS,
): Promise<CollectionStat[] | null> {
  const filePath = getCollectionsCachePath();
  try {
    const info = await stat(filePath);
    if (Date.now() - info.mtimeMs > maxAgeMs) {
      return null;
    }
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed as CollectionStat[];
  } catch {
    return null;
  }
}

export async function writeCollectionsCache(
  collections: CollectionStat[],
): Promise<void> {
  const filePath = getCollectionsCachePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(collections), "utf8");
  await rename(tmp, filePath);
}

export async function buildCollectionsFromDb(): Promise<CollectionStat[]> {
  const { prisma } = await import("./prisma");

  const [movieCollections, showCollections] = await Promise.all([
    prisma.mediaMovie.findMany({
      where: { collections: { not: null } },
      select: { collections: true },
    }),
    prisma.mediaShow.findMany({
      where: { collections: { not: null } },
      select: { collections: true },
    }),
  ]);

  const collectionMap = new Map<string, number>();
  const addCollections = (raw: { collections: string | null }[]) => {
    for (const item of raw) {
      if (!item.collections) continue;
      try {
        const cols = JSON.parse(item.collections) as unknown;
        if (Array.isArray(cols)) {
          for (const col of cols) {
            if (typeof col === "string" && col.trim()) {
              const key = col.trim();
              collectionMap.set(key, (collectionMap.get(key) || 0) + 1);
            }
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }
  };

  addCollections(movieCollections);
  addCollections(showCollections);

  return Array.from(collectionMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function invalidateCollectionsCache(): Promise<void> {
  const filePath = getCollectionsCachePath();
  try {
    const stale = `${filePath}.stale`;
    await rename(filePath, stale).catch(() => undefined);
  } catch {
    // no cache file
  }
}
