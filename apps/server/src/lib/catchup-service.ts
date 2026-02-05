import { prisma } from '@/lib/prisma';
import { TimingService } from '@/lib/timing-service';
import { PlexAPI } from '@/lib/plex';

/**
 * CatchupService – resolves catchup/timeshift requests.
 *
 * The service translates a (channel, time) pair into a Plex stream URL with
 * the correct seek offset so the viewer can watch previously aired content.
 *
 * No segment recording is required – Plex's native seeking handles everything.
 */
export class CatchupService {
  /**
   * Find the program that was airing on `channelNumber` at `requestedTime`.
   */
  static async getProgramAtTime(channelNumber: number, requestedTime: Date) {
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
    });
    if (!channel) return null;

    // Check the catchup window
    if (!channel.catchupEnabled) return null;
    const { start: windowStart } = TimingService.calculateCatchupWindow(channel, new Date());
    if (requestedTime < windowStart) return null;

    // Find the program whose air-window contains `requestedTime`
    const program = await prisma.program.findFirst({
      where: {
        channelId: channel.id,
        startTime: { lte: requestedTime },
        catchupAvailable: true,
      },
      include: {
        episode: { include: { show: { include: { library: { include: { server: true } } } } } },
        movie: { include: { library: { include: { server: true } } } },
        channel: true,
      },
      orderBy: { startTime: 'desc' },
    });

    if (!program) return null;

    // Verify the program actually covers the requested time
    const programEnd = new Date(program.startTime.getTime() + program.duration);
    if (requestedTime > programEnd) return null;

    // Verify the program is within the catchup window
    if (!TimingService.isProgramCatchupAvailable(program, channel)) return null;

    return program;
  }

  /**
   * Find a program by its ID and verify catchup availability.
   */
  static async getProgramById(programId: string) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: {
        episode: { include: { show: { include: { library: { include: { server: true } } } } } },
        movie: { include: { library: { include: { server: true } } } },
        channel: true,
      },
    });

    if (!program) return null;
    if (!TimingService.isProgramCatchupAvailable(program, program.channel)) return null;

    return program;
  }

  /**
   * Build a catchup stream URL from Plex for a given program + seek position.
   *
   * Returns { streamUrl, seekSeconds, programTitle, remainingMs, programId }.
   */
  static async getCatchupStreamInfo(
    channelNumber: number,
    requestedTime: Date
  ): Promise<{
    streamUrl: string;
    seekSeconds: number;
    programTitle: string;
    remainingMs: number;
    programId: string;
    programStartTime: Date;
    programDuration: number;
  } | null> {
    const program = await this.getProgramAtTime(channelNumber, requestedTime);
    if (!program) return null;

    const mediaInfo = program.movie ?? program.episode;
    const server = program.movie?.library.server ?? program.episode?.show.library.server;

    if (!mediaInfo || !server || server.type !== 'PLEX' || !server.token) {
      return null;
    }

    // Calculate seek offset
    const { seekOffsetMs, remainingMs } = TimingService.getCatchupSeekOffset(program, requestedTime);
    const seekSeconds = Math.floor(seekOffsetMs / 1000);

    // Resolve stream URL from Plex
    const plex = new PlexAPI({ uri: server.url });
    let streamUrl: string;
    try {
      const mediaParts = await plex.getMediaParts(server.url, server.token, mediaInfo.ratingKey);
      if (mediaParts?.partKey) {
        streamUrl = `${server.url}${mediaParts.partKey}?X-Plex-Token=${server.token}`;
      } else {
        streamUrl = `${server.url}/library/metadata/${mediaInfo.ratingKey}?X-Plex-Token=${server.token}`;
      }
    } catch {
      streamUrl = `${server.url}/library/metadata/${mediaInfo.ratingKey}?X-Plex-Token=${server.token}`;
    }

    // Build program title
    let programTitle = 'Unknown';
    if (program.movie) {
      programTitle = program.movie.title;
    } else if (program.episode) {
      programTitle = `${program.episode.show.title} - S${program.episode.seasonNumber}E${program.episode.episodeNumber}: ${program.episode.title}`;
    }

    return {
      streamUrl,
      seekSeconds,
      programTitle,
      remainingMs,
      programId: program.id,
      programStartTime: program.startTime,
      programDuration: program.duration,
    };
  }

  /**
   * List all programs available for catchup on a channel.
   */
  static async listCatchupPrograms(channelNumber: number) {
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
    });
    if (!channel || !channel.catchupEnabled) return [];

    const now = new Date();
    const { start: windowStart } = TimingService.calculateCatchupWindow(channel, now);

    const programs = await prisma.program.findMany({
      where: {
        channelId: channel.id,
        startTime: { gte: windowStart, lte: now },
        catchupAvailable: true,
      },
      include: {
        episode: { include: { show: true } },
        movie: true,
        channel: true,
      },
      orderBy: { startTime: 'desc' },
    });

    return programs;
  }

  /**
   * Check whether catchup is available for a specific channel right now.
   */
  static async isCatchupAvailable(channelNumber: number): Promise<boolean> {
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      select: { catchupEnabled: true, catchupWindowHours: true },
    });
    return channel?.catchupEnabled ?? false;
  }
}
