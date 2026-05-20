import { z } from "zod";
import { publicProcedure } from "../lib/orpc";
import { prisma } from "../lib/prisma";
import {
  getProgramsInWindow,
  guideProgramInclude,
} from "../lib/program-queries";

export const guideRouter = {
  current: publicProcedure
    .input(
      z
        .object({
          lookbackHours: z.number().min(1).max(168).optional(),
          forwardHours: z.number().min(1).max(720).optional(),
        })
        .optional(),
    )
    .handler(async ({ input }) => {
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
      });
      const guideDays = settings?.guideDays || 3;
      const now = new Date();
      const defaultForwardHours = guideDays * 24;
      const lookbackMs = (input?.lookbackHours ?? 48) * 60 * 60 * 1000;
      const forwardMs =
        (input?.forwardHours ?? defaultForwardHours) * 60 * 60 * 1000;
      const startWindow = new Date(now.getTime() - lookbackMs);
      const endTime = new Date(now.getTime() + forwardMs);

      return getProgramsInWindow({
        start: startWindow,
        end: endTime,
        include: guideProgramInclude,
      });
    }),

  channel: publicProcedure
    .input(
      z.object({
        channelId: z.string(),
        hours: z.number().default(12),
      }),
    )
    .handler(async ({ input }) => {
      const now = new Date();
      const endTime = new Date(now.getTime() + input.hours * 60 * 60 * 1000);

      return getProgramsInWindow({
        start: now,
        end: endTime,
        channelIds: [input.channelId],
        include: guideProgramInclude,
      });
    }),
} as const;
