import { normalizeTitle } from './title-normalize';

/**
 * Pure rules for franchise order. No database and no network, so everything here is
 * covered by unit tests. The sync and the editor call these.
 *
 * Order modes (stored as FranchiseSortMode):
 *   CHRONOLOGICAL = "Story order"  - the story list, entries it does not know go last by release date.
 *   RELEASE       = "Release order"- by release date.
 *   RECOMMENDED   = story order where it is known; the rest slot in by release date.
 *                   With no story data at all it is the same as release order.
 */

export type OrderMode = 'CHRONOLOGICAL' | 'RELEASE' | 'RECOMMENDED';
export type EntryKind = 'MOVIE' | 'SHOW' | 'SEASON' | 'EPISODES';

export type Orderable = {
  storyIndex: number | null;
  releaseDate: Date | string | null;
};

function ms(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function byRelease<T extends Orderable>(a: { item: T; i: number }, b: { item: T; i: number }): number {
  const da = ms(a.item.releaseDate);
  const db = ms(b.item.releaseDate);
  if (da != null && db != null && da !== db) return da - db;
  if (da == null && db != null) return 1;
  if (da != null && db == null) return -1;
  const sa = a.item.storyIndex;
  const sb = b.item.storyIndex;
  if (sa != null && sb != null && sa !== sb) return sa - sb;
  return a.i - b.i;
}

/** Sort entries for a mode. Returns a new array; the input is not changed. */
export function orderEntries<T extends Orderable>(entries: readonly T[], mode: OrderMode): T[] {
  const indexed = entries.map((item, i) => ({ item, i }));
  const hasStory = indexed.some((e) => e.item.storyIndex != null);

  if (mode === 'RELEASE' || !hasStory) {
    return indexed.sort(byRelease).map((e) => e.item);
  }

  const known = indexed
    .filter((e) => e.item.storyIndex != null)
    .sort((a, b) => a.item.storyIndex! - b.item.storyIndex! || a.i - b.i);
  const unknown = indexed.filter((e) => e.item.storyIndex == null).sort(byRelease);

  if (mode === 'CHRONOLOGICAL') {
    return [...known, ...unknown].map((e) => e.item);
  }

  // RECOMMENDED: put each unknown entry after the last story entry released on or before it.
  const result = known.map((e) => e.item);
  for (const u of unknown) {
    const t = ms(u.item.releaseDate);
    if (t == null) {
      result.push(u.item);
      continue;
    }
    let at = 0;
    for (let i = 0; i < result.length; i++) {
      const r = ms(result[i].releaseDate);
      if (r != null && r <= t) at = i + 1;
    }
    result.splice(at, 0, u.item);
  }
  return result;
}

/* ---------- stable keys ---------- */

export type KeyParts = {
  kind: EntryKind;
  tmdbId: number | null;
  title: string;
  year: number | null;
  seasonNumber?: number | null;
  episodeStart?: number | null;
  episodeEnd?: number | null;
};

/**
 * The identity a sync merges on. Uses the TMDB id when known, else the title and year,
 * so an item that could not be looked up yet keeps one row until it can be.
 */
export function entryKeyFor(p: KeyParts): string {
  const base = p.tmdbId != null ? String(p.tmdbId) : `~${normalizeTitle(p.title)}|${p.year ?? ''}`;
  switch (p.kind) {
    case 'MOVIE':
      return `movie:${base}`;
    case 'SHOW':
      return `tv:${base}`;
    case 'SEASON':
      return `tv:${base}:s${p.seasonNumber ?? 0}`;
    case 'EPISODES':
      return `tv:${base}:s${p.seasonNumber ?? 0}e${p.episodeStart ?? 0}-${p.episodeEnd ?? 0}`;
  }
}

export function entryLabelFor(p: Pick<KeyParts, 'kind' | 'title' | 'seasonNumber' | 'episodeStart' | 'episodeEnd'>): string {
  switch (p.kind) {
    case 'MOVIE':
    case 'SHOW':
      return p.title;
    case 'SEASON':
      return `${p.title} - Season ${p.seasonNumber}`;
    case 'EPISODES':
      return `${p.title} - S${p.seasonNumber} E${p.episodeStart}-${p.episodeEnd}`;
  }
}

/* ---------- merge a fresh sync into saved rows ---------- */

export type MergeExisting = { id: string; entryKey: string | null; position: number; manual: boolean; excluded: boolean };
export type MergeFresh = { entryKey: string };

export type MergePlan<E extends MergeExisting, F extends MergeFresh> = {
  /** Saved rows to delete (they left the source and nobody added them by hand). */
  remove: E[];
  /** Saved rows that the sync matched; refresh their details but never their hand edits. */
  update: Array<{ row: E; fresh: F }>;
  /** Fresh entries with no saved row yet. */
  create: F[];
  /** The final order, top to bottom. Removed-by-hand rows are kept at the end. */
  order: Array<{ row: E } | { fresh: F }>;
};

/**
 * Merge a freshly built list into the rows already saved, so hand edits survive.
 *  - Rows are matched by entryKey. Matched rows are updated, never recreated.
 *  - Rows added by hand are never removed. Rows removed by hand (excluded) are never added back.
 *  - Normal order: the fresh order wins; hand-added rows stay right after the row they followed.
 *  - Hand-ordered (customOrder): the saved order wins; new entries slot in after the entry
 *    that came before them in the fresh order.
 */
export function mergeFranchiseOrder<E extends MergeExisting, F extends MergeFresh>(
  existing: readonly E[],
  fresh: readonly F[],
  opts: { customOrder: boolean },
): MergePlan<E, F> {
  const saved = [...existing].sort((a, b) => a.position - b.position);
  const freshKeys = new Set(fresh.map((f) => f.entryKey));
  const firstByKey = new Map<string, E>();
  for (const row of saved) {
    if (row.entryKey && !firstByKey.has(row.entryKey)) firstByKey.set(row.entryKey, row);
  }

  const remove: E[] = [];
  const kept: E[] = [];
  for (const row of saved) {
    const duplicate = row.entryKey != null && firstByKey.get(row.entryKey) !== row;
    const stale = !row.manual && !row.excluded && !(row.entryKey && freshKeys.has(row.entryKey));
    if (stale || (duplicate && !row.manual)) remove.push(row);
    else kept.push(row);
  }

  const update: Array<{ row: E; fresh: F }> = [];
  const create: F[] = [];
  const freshById = new Map<string, F>();
  for (const f of fresh) {
    const row = firstByKey.get(f.entryKey);
    if (row && kept.includes(row)) {
      update.push({ row, fresh: f });
      freshById.set(row.id, f);
    } else if (!row) {
      create.push(f);
    }
  }

  const excludedRows = kept.filter((r) => r.excluded);
  const live = kept.filter((r) => !r.excluded);
  type Item = { row: E } | { fresh: F };
  let order: Item[];

  if (opts.customOrder) {
    order = live.map((row) => ({ row }));
    const keyOf = (item: Item) => ('row' in item ? item.row.entryKey : item.fresh.entryKey);
    let previousFreshKey: string | null = null;
    for (const f of fresh) {
      const existingRow = firstByKey.get(f.entryKey);
      const alreadyThere = existingRow && live.includes(existingRow);
      if (existingRow && !alreadyThere) continue; // excluded by hand: stays out
      if (!alreadyThere) {
        let at = 0;
        if (previousFreshKey != null) {
          const idx = order.findIndex((o) => keyOf(o) === previousFreshKey);
          at = idx >= 0 ? idx + 1 : order.length;
        }
        order.splice(at, 0, { fresh: f });
      }
      previousFreshKey = f.entryKey;
    }
  } else {
    order = [];
    for (const f of fresh) {
      const row = firstByKey.get(f.entryKey);
      if (row && row.excluded) continue;
      order.push(row ? { row } : { fresh: f });
    }
    const placed = new Set<E>(order.flatMap((o) => ('row' in o ? [o.row] : [])));
    const loose = live.filter((r) => !placed.has(r));
    for (const row of loose) {
      // Anchor after the nearest earlier saved row that is already placed.
      const myIndex = live.indexOf(row);
      let at = 0;
      for (let i = myIndex - 1; i >= 0; i--) {
        const pos = order.findIndex((o) => 'row' in o && o.row === live[i]);
        if (pos >= 0) {
          at = pos + 1;
          break;
        }
      }
      order.splice(at, 0, { row });
    }
  }

  for (const row of excludedRows) order.push({ row });
  return { remove, update, create, order };
}
