import { normalizeTitle } from './title-normalize';
import type { FranchiseSortMode } from './franchise-collection-order';
import { inferStoryEpisodeOrder } from './franchise-collection-order';

export type StorySupplement = {
  tmdbId: number;
  label: string;
  /** Sort key aligned with inferStoryEpisodeOrder (between saga episodes). */
  storyOrder: number;
};

/**
 * Films that belong in watch order but are often missing from TMDB "collection" lists.
 * Star Wars Collection (10) is the main saga; Rogue One & Solo are separate on TMDB.
 */
export const TMDB_COLLECTION_SUPPLEMENTS: Record<number, StorySupplement[]> = {
  10: [
    // After Episode III, before Episode IV (Rogue One then Solo, then ANH)
    { tmdbId: 330459, label: 'Rogue One: A Star Wars Story', storyOrder: 35 },
    { tmdbId: 348350, label: 'Solo: A Star Wars Story', storyOrder: 36 },
  ],
};

export function getSupplementsForCollection(collectionId: number): StorySupplement[] {
  return TMDB_COLLECTION_SUPPLEMENTS[collectionId] ?? [];
}

export type OrderEntryLike = {
  position: number;
  label: string;
  tmdbId: number | null;
  titlePattern: string;
  releaseDateMs: number | null;
};

function storyOrderForEntry(entry: OrderEntryLike): number {
  const year =
    entry.releaseDateMs != null
      ? new Date(entry.releaseDateMs).getUTCFullYear()
      : undefined;
  const yearStr = year ? `${year}-01-01` : undefined;
  return inferStoryEpisodeOrder(entry.label, yearStr);
}

/** Insert spin-off / supplement films into chronological watch order. */
export function mergeStorySupplements<T extends OrderEntryLike>(
  ordered: T[],
  supplements: StorySupplement[],
  sortMode: FranchiseSortMode,
): T[] {
  if (sortMode !== 'CHRONOLOGICAL' || supplements.length === 0) {
    return ordered;
  }

  const knownIds = new Set(
    ordered.map((e) => e.tmdbId).filter((id): id is number => id != null),
  );
  const result = [...ordered];

  for (const sup of supplements) {
    if (knownIds.has(sup.tmdbId)) continue;

    let insertAt = result.length;
    for (let i = 0; i < result.length; i++) {
      if (sup.storyOrder < storyOrderForEntry(result[i])) {
        insertAt = i;
        break;
      }
    }

    const row = {
      position: insertAt,
      label: sup.label,
      tmdbId: sup.tmdbId,
      titlePattern: normalizeTitle(sup.label),
      releaseDateMs: null,
    } as T;

    result.splice(insertAt, 0, row);
    knownIds.add(sup.tmdbId);
    for (let i = 0; i < result.length; i++) {
      result[i].position = i;
    }
  }

  return result;
}
