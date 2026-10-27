import { z } from 'zod';
import { ORPCError } from '@orpc/server';
import { adminProcedure } from '../lib/orpc';
import { prisma } from '../lib/prisma';
import { parseYoutubeUrl, safeFolderName } from '../lib/youtube/plan';
import { runYoutubeSource } from '../lib/youtube/service';
import { nextFreeChannelNumber } from '../lib/franchise-channel-plan';

const YOUTUBE_CHANNEL_START = 200;

const sourceInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(500),
  maxVideos: z.number().int().min(1).max(200).default(10),
});

function checked(input: { name: string; url: string }) {
  const url = parseYoutubeUrl(input.url);
  if (!url.ok) throw new ORPCError('BAD_REQUEST', { message: url.reason });
  if (!safeFolderName(input.name)) throw new ORPCError('BAD_REQUEST', { message: 'The name needs letters or numbers.' });
  return { name: safeFolderName(input.name), url: url.url };
}

// Admin only: this downloads files onto the server's disk from the internet.
export const youtubeRouter = {
  list: adminProcedure.handler(async () => prisma.youtubeSource.findMany({ orderBy: { name: 'asc' } })),

  create: adminProcedure.input(sourceInput).handler(async ({ input }) => {
    const { name, url } = checked(input);
    if (await prisma.youtubeSource.findUnique({ where: { name } })) {
      throw new ORPCError('BAD_REQUEST', { message: `"${name}" already exists` });
    }
    return prisma.youtubeSource.create({ data: { name, url, maxVideos: input.maxVideos } });
  }),

  update: adminProcedure
    .input(z.object({ id: z.string(), url: z.string().trim().max(500).optional(), maxVideos: z.number().int().min(1).max(200).optional(), enabled: z.boolean().optional() }))
    .handler(async ({ input }) => {
      const { id, url, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      if (url !== undefined) {
        const parsed = parseYoutubeUrl(url);
        if (!parsed.ok) throw new ORPCError('BAD_REQUEST', { message: parsed.reason });
        data.url = parsed.url;
      }
      return prisma.youtubeSource.update({ where: { id }, data });
    }),

  delete: adminProcedure.input(z.object({ id: z.string() })).handler(async ({ input }) => {
    // Downloaded files stay on disk; only the subscription is removed.
    await prisma.youtubeSource.delete({ where: { id: input.id } });
    return { ok: true };
  }),

  /** Start a download in the background; the page polls `list` for the result. */
  runNow: adminProcedure.input(z.object({ id: z.string() })).handler(async ({ input }) => {
    const source = await prisma.youtubeSource.findUnique({ where: { id: input.id } });
    if (!source) throw new ORPCError('NOT_FOUND', { message: 'Source not found' });
    await prisma.youtubeSource.update({ where: { id: source.id }, data: { lastStatus: 'running', lastError: null } });
    void runYoutubeSource(source.id).catch((e) => console.error('[YouTube] run failed:', (e as Error).message));
    return { started: true };
  }),

  /** Make a channel that plays this source's show (once its first videos are in the library). */
  createChannel: adminProcedure.input(z.object({ id: z.string() })).handler(async ({ input }) => {
    const source = await prisma.youtubeSource.findUnique({ where: { id: input.id } });
    if (!source) throw new ORPCError('NOT_FOUND', { message: 'Source not found' });
    if (source.channelId && (await prisma.channel.findUnique({ where: { id: source.channelId } }))) {
      throw new ORPCError('BAD_REQUEST', { message: 'This source already has a channel' });
    }
    const show = await prisma.mediaShow.findFirst({ where: { title: source.name } });
    if (!show) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'The videos are not in the library yet. Run the download, wait for the scan, then try again.',
      });
    }
    const used = (await prisma.channel.findMany({ select: { number: true } })).map((c) => c.number);
    const channel = await prisma.channel.create({
      data: { number: nextFreeChannelNumber(used, YOUTUBE_CHANNEL_START), name: source.name, groupTitle: 'YouTube' },
    });
    await prisma.channelShow.create({ data: { channelId: channel.id, showId: show.id } });
    await prisma.youtubeSource.update({ where: { id: source.id }, data: { channelId: channel.id } });
    try {
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.generateProgramsForChannel(channel.id, 24);
    } catch {
      // best-effort; the scheduler fills the guide on its next pass
    }
    return { channelId: channel.id, number: channel.number, name: channel.name };
  }),
};
