import { prisma } from "@/lib/prisma";

/**
 * CatchupService - Handles all catchup/timeshift functionality
 * 
 * This service manages the logic for determining which programs are available
 * for catchup and calculating the correct seek offsets for Plex streams.
 */

export const CatchupService = {
  /**
   * Get the program that was airing at a specific time for a channel
   */
  async getProgramAtTime(channelNumber: number, requestedTime: Date) {
    // Find the most recent program that has started
    const program = await prisma.program.findFirst({
      where: {
        channel: { number: channelNumber },
        startTime: { lte: requestedTime },
      },
      include: {
        episode: {
          include: { show: { include: { library: { include: { server: true } } } } }
        },
        movie: {
          include: { library: { include: { server: true } } }
        },
      },
      orderBy: { startTime: 'desc' },
    });

    if (!program) return null;

    // Check if the requested time is within the program's duration
    const programEnd = new Date(program.startTime.getTime() + program.duration);
    if (requestedTime > programEnd) {
      return null;
    }

    return program;
  },

  /**
   * Get a program by its ID
   */
  async getProgramById(programId: string) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: {
        episode: {
          include: { show: true }
        },
        movie: true,
        channel: true,
      },
    });

    return program;
  },

  /**
   * Get catchup stream information for a specific time
   */
  async getCatchupStreamInfo(channelNumber: number, requestedTime: Date) {
    const program = await this.getProgramAtTime(channelNumber, requestedTime);
    
    if (!program) {
      throw new Error(`No program found for channel ${channelNumber} at ${requestedTime.toISOString()}`);
    }

    // Calculate seek offset from program start
    const startTimeMs = (program as any).startTime.getTime();
    const requestedTimeMs = requestedTime.getTime();
    const seekOffsetMs = requestedTimeMs - startTimeMs;

    // Calculate end time from start + duration
    const endTime = new Date(startTimeMs + (program as any).duration);
    const remainingMs = endTime.getTime() - requestedTimeMs;

    // Get Plex server info with type assertion
    const progWithIncludes = program as any;
    const server = progWithIncludes.episode?.show?.library?.server ?? progWithIncludes.movie?.library?.server;

    if (!server?.token || server.type !== 'PLEX') {
      throw new Error(`No Plex server found for program ${program.id}`);
    }

    // Construct URL using the pattern from the rest of the app
    const baseUrl = process.env.BASE_URL || `http://localhost:3000`;
    const videoUrl = `${baseUrl}/api/video?channel=${channelNumber}`;

    return {
      channelNumber,
      program: {
        id: program.id,
        title: (program as any).title,
        startTime: (program as any).startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
      videoUrl,
      seekOffsetMs,
      remainingMs,
    };
  },

  /**
   * List all catchup-available programs for a channel
   */
  async listCatchupPrograms(channelNumber: number) {
    const now = new Date();
    const channel = await prisma.channel.findFirst({
      where: { number: channelNumber },
    });

    if (!channel) {
      return [];
    }

    if (!channel.catchupEnabled) {
      return [];
    }

    // Calculate catchup window - programs that have ended within the window
    const windowStart = new Date(now.getTime() - (channel.catchupWindowHours * 60 * 60 * 1000));

    const programs = await prisma.program.findMany({
      where: {
        channelId: channel.id,
        startTime: { gte: windowStart },
        // Programs that have ended (endTime = startTime + duration < now)
        // Filter in JS since we don't have endTime in the schema
        catchupAvailable: true,
      },
      orderBy: { startTime: 'desc' },
      include: {
        episode: {
          include: { show: true }
        },
        movie: true,
      },
    });

    // Filter to only programs that have ended
    const endedPrograms = programs.filter(p => {
      const progEnd = new Date(p.startTime.getTime() + p.duration);
      return progEnd <= now;
    });

    return endedPrograms.map((program: any) => {
      const progEnd = new Date(program.startTime.getTime() + program.duration);
      return {
        id: program.id,
        title: program.title,
        startTime: program.startTime.toISOString(),
        endTime: progEnd.toISOString(),
        duration: program.duration,
      };
    });
  },

  /**
   * Check if catchup is available for a channel
   */
  async isCatchupAvailable(channelNumber: number): Promise<boolean> {
    const channel = await prisma.channel.findFirst({
      where: { number: channelNumber },
    });

    if (!channel) {
      return false;
    }

    return channel.catchupEnabled;
  },
};
