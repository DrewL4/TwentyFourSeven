import type { Prisma } from "../../prisma/generated/client";
import { prisma } from "./prisma";

export const programSummaryInclude = {
  episode: {
    include: {
      show: {
        select: {
          id: true,
          title: true,
          poster: true,
        },
      },
    },
  },
  movie: {
    select: {
      id: true,
      title: true,
      year: true,
      poster: true,
    },
  },
} as const;

export type ProgramSummaryRow = Prisma.ProgramGetPayload<{
  include: typeof programSummaryInclude;
}>;

/** Fields used by the guide grid UI */
export const guideProgramInclude = {
  channel: {
    select: {
      id: true,
      number: true,
      name: true,
      icon: true,
    },
  },
  episode: {
    select: {
      title: true,
      seasonNumber: true,
      episodeNumber: true,
      show: {
        select: {
          title: true,
          poster: true,
        },
      },
    },
  },
  movie: {
    select: {
      title: true,
      year: true,
      poster: true,
    },
  },
} satisfies Prisma.ProgramInclude;

export const defaultGuideProgramInclude = guideProgramInclude;

export async function getProgramsInWindow(args: {
  start: Date;
  end: Date;
  channelIds?: string[];
  include?: Prisma.ProgramInclude;
}) {
  const where: Prisma.ProgramWhereInput = {
    startTime: { gte: args.start, lte: args.end },
  };
  if (args.channelIds?.length) {
    where.channelId = { in: args.channelIds };
  }

  return prisma.program.findMany({
    where,
    include: args.include ?? guideProgramInclude,
    orderBy: [{ channel: { number: "asc" } }, { startTime: "asc" }],
  });
}

type ProgramSlot = { channelId: string; startTime: Date };

function buildSlotOrClause(slots: ProgramSlot[]): Prisma.ProgramWhereInput[] {
  return slots.map((slot) => ({
    channelId: slot.channelId,
    startTime: slot.startTime,
  }));
}

/** One current + one next program per channel without loading the full guide window. */
export async function getCurrentAndNextProgramsPerChannel(
  channelIds: string[],
  now: Date = new Date(),
): Promise<{
  currentByChannel: Map<string, ProgramSummaryRow>;
  nextByChannel: Map<string, ProgramSummaryRow>;
}> {
  if (channelIds.length === 0) {
    return { currentByChannel: new Map(), nextByChannel: new Map() };
  }

  const [currentAgg, nextAgg] = await Promise.all([
    prisma.program.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channelIds }, startTime: { lte: now } },
      _max: { startTime: true },
    }),
    prisma.program.groupBy({
      by: ["channelId"],
      where: { channelId: { in: channelIds }, startTime: { gt: now } },
      _min: { startTime: true },
    }),
  ]);

  const currentSlots: ProgramSlot[] = currentAgg
    .filter((row) => row._max.startTime != null)
    .map((row) => ({
      channelId: row.channelId,
      startTime: row._max.startTime as Date,
    }));

  const nextSlots: ProgramSlot[] = nextAgg
    .filter((row) => row._min.startTime != null)
    .map((row) => ({
      channelId: row.channelId,
      startTime: row._min.startTime as Date,
    }));

  const [currentPrograms, nextPrograms] = await Promise.all([
    currentSlots.length > 0
      ? prisma.program.findMany({
          where: { OR: buildSlotOrClause(currentSlots) },
          include: programSummaryInclude,
        })
      : Promise.resolve([]),
    nextSlots.length > 0
      ? prisma.program.findMany({
          where: { OR: buildSlotOrClause(nextSlots) },
          include: programSummaryInclude,
        })
      : Promise.resolve([]),
  ]);

  return {
    currentByChannel: indexProgramsByChannel(currentPrograms, "max"),
    nextByChannel: indexProgramsByChannel(nextPrograms, "min"),
  };
}

/** Picks one program per channel when OR matches multiple rows at the same slot. */
export function indexProgramsByChannel(
  programs: ProgramSummaryRow[],
  pick: "max" | "min",
): Map<string, ProgramSummaryRow> {
  const byChannel = new Map<string, ProgramSummaryRow>();
  for (const program of programs) {
    const existing = byChannel.get(program.channelId);
    if (!existing) {
      byChannel.set(program.channelId, program);
      continue;
    }
    if (pick === "max" && program.startTime > existing.startTime) {
      byChannel.set(program.channelId, program);
    } else if (pick === "min" && program.startTime < existing.startTime) {
      byChannel.set(program.channelId, program);
    }
  }
  return byChannel;
}
