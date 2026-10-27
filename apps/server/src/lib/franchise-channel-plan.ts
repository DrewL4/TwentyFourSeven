/** Where franchise channels start numbering, so they sit clear of the usual 1-99 lineup. */
export const FRANCHISE_CHANNEL_START = 100;

/** Guide group that collects every franchise channel together. */
export const FRANCHISE_GROUP_TITLE = 'Franchises';

export function nextFreeChannelNumber(used: Iterable<number>, start = FRANCHISE_CHANNEL_START): number {
  const taken = new Set(used);
  let n = start;
  while (taken.has(n)) n += 1;
  return n;
}

/** "Star Wars Collection" -> "Star Wars", so the guide shows a clean channel name. */
export function franchiseChannelName(franchiseName: string): string {
  const cleaned = franchiseName.replace(/\s+(collection|saga|film series|franchise)$/i, '').trim();
  return cleaned || franchiseName.trim();
}
