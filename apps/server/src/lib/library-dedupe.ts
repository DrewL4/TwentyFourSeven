import { normalizeTitle } from './title-normalize';

type Row = { title: string; year?: number | null; tmdbId?: number | null; poster?: string | null };

/**
 * One row per title and year. The same film can sit in the library twice (for example a Plex copy and a
 * local-folder copy); the picker should list it once. Prefer the row that has a TMDB id, then one with a poster.
 * Keeps the order of first appearance.
 */
export function dedupeLibraryRows<T extends Row>(rows: T[]): T[] {
  const best = new Map<string, T>();
  const order: string[] = [];
  const score = (r: T) => (r.tmdbId ? 2 : 0) + (r.poster ? 1 : 0);
  for (const row of rows) {
    const key = `${normalizeTitle(row.title)}|${row.year ?? ''}`;
    const seen = best.get(key);
    if (!seen) {
      best.set(key, row);
      order.push(key);
    } else if (score(row) > score(seen)) {
      best.set(key, row);
    }
  }
  return order.map((k) => best.get(k) as T);
}
