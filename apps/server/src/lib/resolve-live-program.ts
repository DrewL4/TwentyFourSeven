import { prisma } from "@/lib/prisma";
import { PlexAPI } from "@/lib/plex";
import { TimingService } from "@/lib/timing-service";

export type ScheduledProgramRow = {
  id: string;
  startTime: Date;
  duration: number;
  movie?: {
    title?: string | null;
    ratingKey: string;
    library: { server: LivePlexServer | null };
  } | null;
  episode?: {
    title?: string | null;
    ratingKey: string;
    show: {
      title: string;
      library: { server: LivePlexServer | null };
    };
  } | null;
};

export type LivePlexServer = {
  type: string;
  url: string;
  token: string | null;
};

export type ResolvedLiveProgram = {
  programId: string;
  programInfo: { ratingKey: string };
  server: LivePlexServer;
  timing: {
    seekOffsetMs: number;
    isActive: boolean;
    remainingMs: number;
  };
  streamUrl: string;
  seekSeconds: number;
  programTitle?: string;
};

const liveProgramInclude = {
  episode: {
    include: {
      show: { include: { library: { include: { server: true } } } },
    },
  },
  movie: { include: { library: { include: { server: true } } } },
} as const;

/**
 * Choose the program a live 24/7 channel should play.
 *
 * Prefers the row whose window contains `now`. When the current file has
 * already finished (`skipProgramId`), jump to the next scheduled row even if
 * that window has not started yet so playback does not stall between episodes.
 */
export function pickScheduledProgram<T extends { id: string; startTime: Date; duration: number }>(
  programs: T[],
  now: Date,
  options?: { skipProgramId?: string },
): T | null {
  const skipId = options?.skipProgramId;
  const eligible = skipId ? programs.filter((program) => program.id !== skipId) : programs;
  const nowMs = now.getTime();

  const overlapping = eligible
    .filter((program) => {
      const start = program.startTime.getTime();
      const end = start + program.duration;
      return start <= nowMs && nowMs < end;
    })
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  if (overlapping[0]) {
    return overlapping[0];
  }

  const upcoming = eligible
    .filter((program) => program.startTime.getTime() >= nowMs)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  if (upcoming[0]) {
    return upcoming[0];
  }

  if (skipId) {
    const skipped = programs.find((program) => program.id === skipId);
    if (skipped) {
      const skipEnd = skipped.startTime.getTime() + skipped.duration;
      const afterSkip = eligible
        .filter((program) => program.startTime.getTime() >= skipEnd - 1)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      if (afterSkip[0]) {
        return afterSkip[0];
      }
    }
  }

  return null;
}

export function liveProgramTitle(program: ScheduledProgramRow): string | undefined {
  if (program.movie?.title) {
    return program.movie.title;
  }
  if (program.episode) {
    return `${program.episode.show.title} - ${program.episode.title || "Episode"}`;
  }
  return undefined;
}

export async function listScheduledProgramsForChannel(
  channelNumber: number,
  now: Date = new Date(),
): Promise<ScheduledProgramRow[]> {
  const channel = await prisma.channel.findUnique({
    where: { number: channelNumber },
    select: { id: true },
  });
  if (!channel) {
    return [];
  }

  const [started, upcoming] = await Promise.all([
    prisma.program.findMany({
      where: {
        channelId: channel.id,
        startTime: { lte: now },
      },
      include: liveProgramInclude,
      orderBy: { startTime: "desc" },
      take: 8,
    }),
    prisma.program.findMany({
      where: {
        channelId: channel.id,
        startTime: { gt: now },
      },
      include: liveProgramInclude,
      orderBy: { startTime: "asc" },
      take: 8,
    }),
  ]);

  const byId = new Map<string, ScheduledProgramRow>();
  for (const row of [...started, ...upcoming]) {
    byId.set(row.id, row as ScheduledProgramRow);
  }
  return [...byId.values()];
}

export async function loadLiveProgramForChannel(
  channelNumber: number,
  options?: { skipProgramId?: string; now?: Date },
): Promise<ResolvedLiveProgram | null> {
  const now = options?.now ?? new Date();
  const picked = pickScheduledProgram(
    await listScheduledProgramsForChannel(channelNumber, now),
    now,
    { skipProgramId: options?.skipProgramId },
  );
  if (!picked) {
    return null;
  }

  const programInfo = picked.movie ?? picked.episode;
  const server =
    picked.movie?.library.server ?? picked.episode?.show.library.server ?? null;
  if (!programInfo || !server || server.type !== "PLEX" || !server.token) {
    return null;
  }

  const plex = new PlexAPI({ uri: server.url });
  const mediaParts = await plex.getMediaParts(
    server.url,
    server.token,
    programInfo.ratingKey,
  );
  if (!mediaParts?.partKey) {
    return null;
  }

  const timing = TimingService.calculateSeekOffset(
    picked.startTime,
    picked.duration,
    now,
  );
  const seekSeconds =
    timing.isActive && timing.seekOffsetMs > 0
      ? Math.floor(timing.seekOffsetMs / 1000)
      : 0;

  return {
    programId: picked.id,
    programInfo: { ratingKey: programInfo.ratingKey },
    server,
    timing: {
      ...timing,
      seekOffsetMs: seekSeconds * 1000,
    },
    streamUrl: `${server.url}${mediaParts.partKey}?X-Plex-Token=${server.token}`,
    seekSeconds,
    programTitle: liveProgramTitle(picked),
  };
}
