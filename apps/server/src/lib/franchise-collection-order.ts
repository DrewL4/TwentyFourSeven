import type { TmdbCollectionPart } from './tmdb-service';

export type FranchiseSortMode = 'CHRONOLOGICAL' | 'RELEASE';

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};

function romanToInt(roman: string): number | null {
  const key = roman.toUpperCase();
  return ROMAN_VALUES[key] ?? null;
}

/**
 * Infer saga episode sequence from TMDB title (and year fallback) for story-order sorting.
 * Returns 999 when unknown so those titles sort after numbered episodes.
 */
export function inferStoryEpisodeOrder(title: string, releaseDate?: string): number {
  const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : null;
  const norm = title.toLowerCase();

  // Decade steps leave room for spin-offs between saga episodes (e.g. III → Rogue → Solo → IV).
  if (norm.includes('phantom menace')) return 10;
  if (norm.includes('attack of the clones')) return 20;
  if (norm.includes('revenge of the sith')) return 30;
  if (norm.includes('rogue one')) return 35;
  if (norm.includes('solo') && norm.includes('star wars')) return 36;
  if (norm === 'star wars' || (norm.startsWith('star wars') && year === 1977)) return 40;
  if (norm.includes('empire strikes back')) return 50;
  if (norm.includes('return of the jedi')) return 60;
  if (norm.includes('force awakens')) return 70;
  if (norm.includes('last jedi')) return 80;
  if (norm.includes('rise of skywalker')) return 90;

  const romanMatch = title.match(/\bEpisode\s+([IVX]+)\b/i);
  if (romanMatch) {
    const n = romanToInt(romanMatch[1]);
    if (n != null) return n * 10;
  }

  const numMatch = title.match(/\bEpisode\s+(\d+)\b/i);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (Number.isFinite(n)) return n * 10;
  }

  return 999;
}

export function sortCollectionPartsForWatchOrder(
  parts: TmdbCollectionPart[],
  sortMode: FranchiseSortMode,
): TmdbCollectionPart[] {
  const copy = [...parts];
  if (sortMode === 'RELEASE') {
    return copy.sort((a, b) => {
      const da = a.release_date ? Date.parse(a.release_date) : 0;
      const db = b.release_date ? Date.parse(b.release_date) : 0;
      return da - db;
    });
  }

  return copy.sort((a, b) => {
    const orderA = inferStoryEpisodeOrder(a.title, a.release_date);
    const orderB = inferStoryEpisodeOrder(b.title, b.release_date);
    if (orderA !== orderB) return orderA - orderB;
    const da = a.release_date ? Date.parse(a.release_date) : 0;
    const db = b.release_date ? Date.parse(b.release_date) : 0;
    return da - db;
  });
}
