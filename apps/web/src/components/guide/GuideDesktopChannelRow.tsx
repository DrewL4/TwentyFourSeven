"use client";

import type { KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Rewind, Zap } from "lucide-react";

export type GuideProgram = {
  id: string;
  startTime: string | Date;
  duration: number;
  channel: {
    id: string;
    number: number;
    name: string;
    icon?: string | null;
  };
  episode?: {
    title: string;
    seasonNumber: number;
    episodeNumber: number;
    show: {
      title: string;
      poster?: string | null;
    };
  } | null;
  movie?: {
    title: string;
    year?: number | null;
    poster?: string | null;
  } | null;
};

export type GuideChannel = {
  id: string;
  number: number;
  name: string;
  icon?: string | null;
  catchupEnabled?: boolean;
  catchupWindowHours?: number;
};

export type GuideDesktopChannelRowProps = {
  channel: GuideChannel;
  channelPrograms: GuideProgram[];
  timeSlots: Date[];
  guideStartTime: Date;
  currentTime: Date;
  formatTime: (date: Date | string) => string;
  isCurrentlyPlaying: (startTime: string | Date, duration: number) => boolean;
  getProgressPercentage: (startTime: string | Date, duration: number) => number;
  isPastProgram: (startTime: string | Date, duration: number) => boolean;
  isCatchupEligible: (
    channelId: string,
    startTime: string | Date,
    duration: number,
  ) => boolean;
  onPlayLive: (channel: GuideChannel) => void;
  onPlayCatchup: (channel: GuideChannel, programStartTime: string | Date) => void;
  onRegenerate: (channelId: string) => void;
  isRegeneratePending: boolean;
};

const SLOT_DURATION = 30 * 60 * 1000;
const GUIDE_WINDOW_MS = 6 * 60 * 60 * 1000;

export function GuideDesktopChannelRow({
  channel,
  channelPrograms,
  timeSlots,
  guideStartTime,
  currentTime,
  formatTime,
  isCurrentlyPlaying,
  getProgressPercentage,
  isPastProgram,
  isCatchupEligible,
  onPlayLive,
  onPlayCatchup,
  onRegenerate,
  isRegeneratePending,
}: GuideDesktopChannelRowProps) {
  const guideEnd = new Date(guideStartTime.getTime() + GUIDE_WINDOW_MS);
  const isWithinGuideWindow =
    currentTime >= guideStartTime && currentTime <= guideEnd;
  const timeOffset = currentTime.getTime() - guideStartTime.getTime();
  const nowLineLeft = (timeOffset / GUIDE_WINDOW_MS) * 100;

  return (
    <div className="flex border-b hover:bg-muted/20 min-h-[60px]">
      <div className="w-48 p-2 border-r bg-background sticky left-0 z-10 flex items-center">
        <div className="flex items-center gap-2 w-full">
          <Badge variant="outline" className="text-xs px-1.5 py-0.5 flex-shrink-0">
            {channel.number}
          </Badge>
          {channel.icon ? (
            <img
              src={channel.icon}
              alt=""
              className="w-6 h-6 rounded object-cover flex-shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <p className="font-medium text-xs leading-tight truncate flex-1" title={channel.name}>
            {channel.name}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="flex-shrink-0 h-6 w-6 p-0"
            onClick={() => onPlayLive(channel)}
          >
            <Play className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-shrink-0 h-6 w-6 p-0"
            title="Regenerate this channel's guide"
            onClick={() => onRegenerate(channel.id)}
            disabled={isRegeneratePending}
          >
            <Zap className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div className="flex-1 relative">
        <div className="flex relative">
          {timeSlots.map((slotStart, slotIndex) => {
            const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION);
            const isCurrentSlot =
              currentTime >= slotStart && currentTime < slotEnd;
            return (
              <div
                key={slotIndex}
                className={`flex-1 border-r min-h-[60px] min-w-[80px] max-w-[100px] ${
                  isCurrentSlot ? "bg-blue-50 dark:bg-blue-950/30" : ""
                }`}
              />
            );
          })}
        </div>
        {isWithinGuideWindow ? (
          <div
            className="absolute top-0 w-px h-full bg-blue-500 z-30 pointer-events-none"
            style={{ left: `${nowLineLeft}%` }}
          />
        ) : null}
        <div className="absolute inset-0">
          {channelPrograms.map((program) => {
            const programStart =
              typeof program.startTime === "string"
                ? new Date(program.startTime)
                : program.startTime;
            const programEnd = new Date(
              programStart.getTime() + program.duration,
            );
            if (programEnd <= guideStartTime || programStart >= guideEnd) {
              return null;
            }
            const startOffset = Math.max(
              0,
              programStart.getTime() - guideStartTime.getTime(),
            );
            const endOffset = Math.min(
              guideEnd.getTime() - guideStartTime.getTime(),
              programEnd.getTime() - guideStartTime.getTime(),
            );
            const left = (startOffset / GUIDE_WINDOW_MS) * 100;
            const width = ((endOffset - startOffset) / GUIDE_WINDOW_MS) * 100;
            const isCurrentProgram = isCurrentlyPlaying(
              program.startTime,
              program.duration,
            );
            const isPast = isPastProgram(program.startTime, program.duration);
            const catchupEligible = isCatchupEligible(
              channel.id,
              program.startTime,
              program.duration,
            );
            const label = program.episode
              ? program.episode.show.title
              : program.movie?.title;
            return (
              <div
                key={program.id}
                role="button"
                tabIndex={0}
                className={`absolute top-1 bottom-1 mx-0.5 rounded text-xs overflow-hidden cursor-pointer ${
                  isCurrentProgram
                    ? "bg-blue-500 text-white"
                    : catchupEligible
                      ? "bg-amber-100 dark:bg-amber-900/40"
                      : isPast
                        ? "bg-muted/50 text-muted-foreground opacity-60"
                        : "bg-accent"
                }`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={label}
                onClick={() => {
                  if (catchupEligible) {
                    onPlayCatchup(channel, program.startTime);
                  }
                }}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" && catchupEligible) {
                    onPlayCatchup(channel, program.startTime);
                  }
                }}
              >
                <div className="p-1.5 h-full overflow-hidden">
                  <div className="font-medium line-clamp-1 flex items-center gap-1">
                    {catchupEligible ? (
                      <Rewind className="w-3 h-3 flex-shrink-0" />
                    ) : null}
                    {label}
                  </div>
                  <div className="text-[10px] opacity-75">
                    {formatTime(program.startTime)}
                  </div>
                  {isCurrentProgram ? (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
                      <div
                        className="h-full bg-white"
                        style={{
                          width: `${getProgressPercentage(program.startTime, program.duration)}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

