import { prisma as defaultPrisma } from "./prisma";

export type LibraryFacet = "actors" | "directors" | "genres" | "studio";

type Db = Pick<typeof defaultPrisma, "mediaMovie" | "mediaShow">;

/**
 * Sorted distinct actors, directors, genres or studios across movies and shows.
 *
 * The channel editor asks for these on open and on every keystroke. Each answer
 * used to read and JSON-parse that column for the whole library. The parsed list
 * is now kept until the library changes; a change shows up in the row counts or
 * the newest updatedAt (all writes go through Prisma, which maintains it).
 * The lists (about 5 MB for a 6,000-title library) are dropped once the editor
 * has been idle for IDLE_DROP_MS, so they do not stay resident.
 */
const cache = new Map<LibraryFacet, { signature: string; values: string[] }>();
const IDLE_DROP_MS = 2 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function dropWhenIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(clearLibraryFacetCache, IDLE_DROP_MS);
  idleTimer.unref?.();
}

async function librarySignature(db: Db): Promise<string> {
  const [movies, shows] = await Promise.all([
    db.mediaMovie.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    db.mediaShow.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
  ]);
  return [
    movies._count._all,
    movies._max.updatedAt?.getTime() ?? 0,
    shows._count._all,
    shows._max.updatedAt?.getTime() ?? 0,
  ].join(":");
}

function addValues(field: LibraryFacet, raw: string | null, into: Set<string>) {
  if (!raw) return;
  if (field === "studio") {
    if (raw.trim()) into.add(raw.trim());
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const value of parsed) {
      if (typeof value === "string" && value.trim()) into.add(value.trim());
    }
  } catch {
    // Skip invalid JSON, as before.
  }
}

async function readFacet(field: LibraryFacet, db: Db): Promise<string[]> {
  // All four facets are nullable string columns on both models; a computed select key
  // makes Prisma infer a union of row types, so the rows are typed by hand here.
  type Rows = Promise<Record<LibraryFacet, string | null>[]>;
  const where = { [field]: { not: null } };
  const select = { [field]: true };
  const [movies, shows] = await Promise.all([
    db.mediaMovie.findMany({ where, select }) as unknown as Rows,
    db.mediaShow.findMany({ where, select }) as unknown as Rows,
  ]);
  const values = new Set<string>();
  for (const row of movies) addValues(field, row[field], values);
  for (const row of shows) addValues(field, row[field], values);
  return Array.from(values).sort();
}

export async function libraryFacetValues(field: LibraryFacet, db: Db = defaultPrisma): Promise<string[]> {
  dropWhenIdle();
  const signature = await librarySignature(db);
  const hit = cache.get(field);
  if (hit && hit.signature === signature) return hit.values;
  const values = await readFacet(field, db);
  cache.set(field, { signature, values });
  return values;
}

/** The autocomplete answer: substring match on the lowercased value, first `limit` in sort order. */
export async function searchLibraryFacet(
  field: LibraryFacet,
  search: string | undefined,
  limit: number,
  db: Db = defaultPrisma,
): Promise<string[]> {
  const values = await libraryFacetValues(field, db);
  // Same matching as before: untrimmed lowercase substring, only when the search is not blank.
  const term = search && search.trim() ? search.toLowerCase() : null;
  return (term ? values.filter((value) => value.toLowerCase().includes(term)) : values).slice(0, limit);
}

export function clearLibraryFacetCache(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  cache.clear();
}
