import { prisma as defaultPrisma } from "./prisma";

const DELETE_CHUNK = 500;

/**
 * Delete a channel's existing programmes that overlap any of the programmes about to
 * be inserted (half-open intervals: start < otherEnd && end > otherStart).
 *
 * One read for every candidate row, instead of one read per new programme. The old
 * per-programme query matched every earlier programme on the channel (it cannot
 * filter on startTime + duration), so it re-read the whole catch-up history once
 * for each programme in the guide window.
 */
export async function removeOverlappingPrograms(
  channelId: string,
  programs: Array<{ startTime: Date; duration: number }>,
  db: typeof defaultPrisma = defaultPrisma,
): Promise<number> {
  if (programs.length === 0) return 0;

  const windows = programs
    .map((p) => {
      const start = p.startTime.getTime();
      return { start, end: start + p.duration };
    })
    .sort((a, b) => a.start - b.start);
  const maxEnd = Math.max(...windows.map((w) => w.end));

  // Every row that can overlap starts before the last new programme ends.
  const existing = await db.program.findMany({
    where: { channelId, startTime: { lt: new Date(maxEnd) } },
    select: { id: true, startTime: true, duration: true },
  });

  const ids: string[] = [];
  for (const row of existing) {
    const start = row.startTime.getTime();
    const end = start + row.duration;
    // windows is sorted by start, so nothing past the first window starting at or after `end` can overlap.
    for (const w of windows) {
      if (w.start >= end) break;
      if (w.end > start && w.start < end) {
        ids.push(row.id);
        break;
      }
    }
  }

  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    await db.program.deleteMany({ where: { id: { in: ids.slice(i, i + DELETE_CHUNK) } } });
  }
  if (ids.length > 0) {
    console.log(`Removing ${ids.length} overlapping programs for channel ${channelId}`);
  }
  return ids.length;
}
