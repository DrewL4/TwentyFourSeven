import type { Prisma } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { TimingService } from "@/lib/timing-service";

const programWithMediaInclude = {
  episode: {
    include: { show: { include: { library: { include: { server: true } } } } },
  },
  movie: {
    include: { library: { include: { server: true } } },
  },
  channel: true,
} as const;

export type CatchupProgramRecord = Prisma.ProgramGetPayload<{
  include: typeof programWithMediaInclude;
}>;

export type CatchupStreamInfo = {
  channelNumber: number;
  program: {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    catchupExpiry: string | null;
  };
  seekOffsetMs: number;
  remainingMs: number;
};

async function getCatchupContext(channelNumber: number) {
  const [channel, settings] = await Promise.all([
    prisma.channel.findFirst({ where: { number: channelNumber } }),
    prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { catchupEnabled: true },
    }),
  ]);

  if (!channel) {
    return null;
  }

  const globalCatchupEnabled = settings?.catchupEnabled ?? true;
  const enabled = globalCatchupEnabled && channel.catchupEnabled;

  return { channel, globalCatchupEnabled, enabled };
}

function getProgramTitle(program: CatchupProgramRecord): string {
  if (program.movie?.title) {
    return program.movie.title;
  }
  if (program.episode) {
    const episodeTitle = program.episode.title?.trim();
    return episodeTitle
      ? `${program.episode.show.title} - ${episodeTitle}`
      : program.episode.show.title;
  }
  return "Unknown program";
}

function getPlexServerFromProgram(program: CatchupProgramRecord) {
  return (
    program.movie?.library?.server ??
    program.episode?.show?.library?.server ??
    null
  );
}

/**
 * CatchupService - catchup/timeshift lookups and stream timing.
 *
 * Eligibility and seek math delegate to TimingService so M3U, XMLTV, API,
 * and /api/video share one definition of the catchup window.
 */
export const CatchupService = {
  async getCatchupContext(channelNumber: number) {
    return getCatchupContext(channelNumber);
  },

  /**
   * Find the program airing at `requestedTime` (start inclusive, end exclusive).
   */
  async getProgramAtTime(
    channelNumber: number,
    requestedTime: Date,
  ): Promise<CatchupProgramRecord | null> {
    const program = await prisma.program.findFirst({
      where: {
        channel: { number: channelNumber },
        startTime: { lte: requestedTime },
      },
      include: programWithMediaInclude,
      orderBy: { startTime: "desc" },
    });

    if (!program?.channel) {
      return null;
    }

    const programEnd = new Date(program.startTime.getTime() + program.duration);
    if (requestedTime.getTime() >= programEnd.getTime()) {
      return null;
    }

    return program;
  },

  async getProgramById(programId: string): Promise<CatchupProgramRecord | null> {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      include: programWithMediaInclude,
    });

    if (!program?.channel) {
      return null;
    }

    return program;
  },

  /**
   * Resolve catchup from ISO time, Unix utc seconds, or program id.
   */
  async resolveCatchupRequest(
    channelNumber: number,
    options: {
      requestedTime?: Date;
      programId?: string;
    },
  ): Promise<{
    program: CatchupProgramRecord;
    requestedTime: Date;
    seekOffsetMs: number;
    remainingMs: number;
  } | null> {
    const context = await getCatchupContext(channelNumber);
    if (!context?.enabled) {
      return null;
    }

    const { channel } = context;
    const now = new Date();

    let program: CatchupProgramRecord | null = null;
    let requestedTime = options.requestedTime;

    if (options.programId) {
      program = await this.getProgramById(options.programId);
      if (!program || program.channel.number !== channelNumber) {
        return null;
      }
      requestedTime = program.startTime;
    } else if (requestedTime) {
      program = await this.getProgramAtTime(channelNumber, requestedTime);
    } else {
      return null;
    }

    if (!program || !requestedTime) {
      return null;
    }

    if (
      !TimingService.isProgramCatchupAvailable(program, channel, now)
    ) {
      return null;
    }

    const { seekOffsetMs, remainingMs } = TimingService.getCatchupSeekOffset(
      program,
      requestedTime,
    );

    return { program, requestedTime, seekOffsetMs, remainingMs };
  },

  async getCatchupStreamInfo(
    channelNumber: number,
    requestedTime: Date,
  ): Promise<CatchupStreamInfo | null> {
    const resolved = await this.resolveCatchupRequest(channelNumber, {
      requestedTime,
    });

    if (!resolved) {
      return null;
    }

    const { program, seekOffsetMs, remainingMs } = resolved;
    const programEnd = new Date(program.startTime.getTime() + program.duration);
    const expiry = program.catchupExpiry
      ? new Date(program.catchupExpiry)
      : TimingService.calculateCatchupExpiry(
          programEnd,
          program.channel.catchupWindowHours,
        );

    const server = getPlexServerFromProgram(program);
    if (!server?.token || server.type !== "PLEX") {
      throw new Error(`No Plex server found for program ${program.id}`);
    }

    return {
      channelNumber,
      program: {
        id: program.id,
        title: getProgramTitle(program),
        startTime: program.startTime.toISOString(),
        endTime: programEnd.toISOString(),
        catchupExpiry: expiry.toISOString(),
      },
      seekOffsetMs,
      remainingMs,
    };
  },

  async listCatchupPrograms(channelNumber: number) {
    const context = await getCatchupContext(channelNumber);
    if (!context?.enabled) {
      return [];
    }

    const { channel } = context;
    const now = new Date();
    const { start: windowStart } = TimingService.calculateCatchupWindow(
      channel,
      now,
    );

    const programs = await prisma.program.findMany({
      where: {
        channelId: channel.id,
        startTime: { gte: windowStart },
        catchupAvailable: true,
      },
      orderBy: { startTime: "desc" },
      include: programWithMediaInclude,
    });

    return programs
      .filter((program) =>
        TimingService.isProgramCatchupAvailable(program, channel, now),
      )
      .map((program) => {
        const progEnd = new Date(program.startTime.getTime() + program.duration);
        return {
          id: program.id,
          title: getProgramTitle(program),
          startTime: program.startTime.toISOString(),
          endTime: progEnd.toISOString(),
          duration: program.duration,
          catchupExpiry: program.catchupExpiry?.toISOString() ?? null,
        };
      });
  },

  async isCatchupAvailable(channelNumber: number): Promise<boolean> {
    const context = await getCatchupContext(channelNumber);
    return context?.enabled ?? false;
  },

  getProgramTitle,
};
