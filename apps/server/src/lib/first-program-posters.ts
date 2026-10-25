import { prisma as defaultPrisma } from "./prisma";

const CHUNK = 200;

/**
 * Poster of each channel's earliest programme (show poster, else movie poster),
 * in two queries per 200 channels instead of one findFirst per channel.
 * Channels with no programmes or no poster map to null.
 */
export async function firstProgramPosters(
  channelIds: string[],
  db: typeof defaultPrisma = defaultPrisma,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < channelIds.length; i += CHUNK) {
    const ids = channelIds.slice(i, i + CHUNK);
    const firsts = await db.program.groupBy({
      by: ["channelId"],
      where: { channelId: { in: ids } },
      _min: { startTime: true },
    });
    const pairs = firsts.filter((f) => f._min.startTime);
    if (pairs.length === 0) continue;
    const programs = await db.program.findMany({
      where: { OR: pairs.map((f) => ({ channelId: f.channelId, startTime: f._min.startTime as Date })) },
      select: {
        channelId: true,
        episode: { select: { show: { select: { poster: true } } } },
        movie: { select: { poster: true } },
      },
    });
    for (const p of programs) {
      if (out.has(p.channelId)) continue;
      out.set(p.channelId, p.episode?.show?.poster || p.movie?.poster || null);
    }
  }
  return out;
}
