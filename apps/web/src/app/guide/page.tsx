"use client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tv, Clock, Calendar, Play, Film, RefreshCw, Zap, Settings, ChevronLeft, ChevronRight, Rewind } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
import {
  GuideDesktopChannelRow,
  type GuideChannel,
} from "@/components/guide/GuideDesktopChannelRow";
import { HEAVY_QUERY_OPTIONS } from "@/utils/query-options";
import Link from "next/link";
import { toast } from "sonner";
import VideoPlayer from "@/components/video-player";

type Program = {
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

export default function GuidePage() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [guideStartTime, setGuideStartTime] = useState(() => {
    const now = new Date();
    // Round down to the nearest 30 minutes
    const minutes = now.getMinutes();
    const roundedMinutes = Math.floor(minutes / 30) * 30;
    now.setMinutes(roundedMinutes, 0, 0);
    return now;
  });
  const [isMobileView, setIsMobileView] = useState(false);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [playingChannel, setPlayingChannel] = useState<{ number: number; name: string; icon?: string | null } | null>(null);
  // Catchup state
  const [isCatchupMode, setIsCatchupMode] = useState(false);
  const [catchupTime, setCatchupTime] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  
  const settingsQuery = useQuery(orpc.settings.get.queryOptions());

  const guideWindowInput = useMemo(() => {
    const guideDays = settingsQuery.data?.guideDays ?? 3;
    return {
      lookbackHours: 48,
      forwardHours: guideDays * 24,
    };
  }, [settingsQuery.data?.guideDays]);

  const guideQuery = useQuery({
    ...orpc.guide.current.queryOptions({ input: guideWindowInput }),
    ...HEAVY_QUERY_OPTIONS,
    enabled: settingsQuery.isSuccess,
  });
  const channelsQuery = useQuery(orpc.channels.listSummary.queryOptions());

  const programsByChannelId = useMemo(() => {
    const map = new Map<string, Program[]>();
    if (!guideQuery.data) {
      return map;
    }
    for (const program of guideQuery.data as Program[]) {
      const existing = map.get(program.channel.id);
      if (existing) {
        existing.push(program);
      } else {
        map.set(program.channel.id, [program]);
      }
    }
    for (const programs of map.values()) {
      programs.sort((a, b) => {
        const aTime =
          typeof a.startTime === "string"
            ? new Date(a.startTime)
            : a.startTime;
        const bTime =
          typeof b.startTime === "string"
            ? new Date(b.startTime)
            : b.startTime;
        return aTime.getTime() - bTime.getTime();
      });
    }
    return map;
  }, [guideQuery.data]);

  const sortedChannels = useMemo((): GuideChannel[] => {
    if (!channelsQuery.data) {
      return [];
    }
    return [...(channelsQuery.data as GuideChannel[])].sort(
      (a, b) => a.number - b.number,
    );
  }, [channelsQuery.data]);

  const catchupByChannelId = useMemo(() => {
    const map = new Map<string, { enabled: boolean; windowHours: number }>();
    const globalCatchupEnabled = settingsQuery.data?.catchupEnabled ?? true;
    if (!channelsQuery.data) {
      return map;
    }
    for (const channel of channelsQuery.data as Array<{
      id: string;
      catchupEnabled: boolean;
      catchupWindowHours: number;
    }>) {
      map.set(channel.id, {
        enabled: globalCatchupEnabled && channel.catchupEnabled,
        windowHours: channel.catchupWindowHours ?? 24,
      });
    }
    return map;
  }, [channelsQuery.data, settingsQuery.data?.catchupEnabled]);

  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const generateProgramsMutation = useMutation(orpc.programming.generateForAllChannels.mutationOptions({
    onSuccess: () => {
      toast.success("Programs generated successfully!");
      queryClient.invalidateQueries({ queryKey: ['guide'] });
    },
    onError: (error) => {
      toast.error(`Failed to generate programs: ${error.message}`);
    }
  }));

  const maintainProgramsMutation = useMutation(orpc.programming.maintain.mutationOptions({
    onSuccess: () => {
      toast.success("Programs refreshed!");
      queryClient.invalidateQueries({ queryKey: ['guide'] });
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: (error) => {
      toast.error(`Failed to refresh programs: ${error.message}`);
    }
  }));

  const generateForChannelMutation = useMutation(orpc.channels.generatePrograms.mutationOptions({
    onSuccess: () => {
      toast.success("Channel programs generated!");
      queryClient.invalidateQueries({ queryKey: ['guide'] });
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: (error) => {
      toast.error(`Failed to generate channel programs: ${error.message}`);
    }
  }));

  // Check if mobile view on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update current time every 30 seconds for smoother real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (dateInput: string | Date) => {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const formatTimeShort = (dateInput: string | Date) => {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric',
      hour12: true 
    });
  };

  const formatDate = (dateInput: string | Date) => {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric'
    });
  };

  const formatDateLong = (dateInput: string | Date) => {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric'
    });
  };

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
  };

  const getProgressPercentage = (startTime: string | Date, duration: number) => {
    const start = (typeof startTime === 'string' ? new Date(startTime) : startTime).getTime();
    const end = start + duration;
    const now = currentTime.getTime();
    
    if (now < start) return 0;
    if (now > end) return 100;
    
    return ((now - start) / duration) * 100;
  };

  const isCurrentlyPlaying = (startTime: string | Date, duration: number) => {
    const start = (typeof startTime === 'string' ? new Date(startTime) : startTime).getTime();
    const end = start + duration;
    const now = currentTime.getTime();
    
    return now >= start && now <= end;
  };

  // Get current and next programs for a channel (mobile view)
  const getCurrentAndNextPrograms = (channelId: string) => {
    const channelPrograms = programsByChannelId.get(channelId) ?? [];
    if (channelPrograms.length === 0) {
      return { current: null, next: null };
    }

    const now = currentTime.getTime();
    let current = null;
    let next = null;

    for (let i = 0; i < channelPrograms.length; i++) {
      const program = channelPrograms[i];
      const startTime = typeof program.startTime === 'string' ? new Date(program.startTime) : program.startTime;
      const endTime = new Date(startTime.getTime() + program.duration);

      if (startTime.getTime() <= now && endTime.getTime() > now) {
        current = program;
        next = channelPrograms[i + 1] || null;
        break;
      } else if (startTime.getTime() > now && !current) {
        next = program;
        break;
      }
    }

    return { current, next };
  };

  // Generate time slots for the guide (30-minute intervals)
  const generateTimeSlots = (startTime: Date, hours: number = 6) => {
    const slots = [];
    const slotDuration = 30 * 60 * 1000; // 30 minutes in milliseconds
    
    for (let i = 0; i < (hours * 2); i++) {
      const slotTime = new Date(startTime.getTime() + (i * slotDuration));
      slots.push(slotTime);
    }
    
    return slots;
  };

  // Get program for a specific channel and time slot
  const getProgramForSlot = (programs: Program[], channelId: string, slotStart: Date, slotEnd: Date) => {
    return programs.find(program => {
      if (program.channel.id !== channelId) return false;
      
      const programStart = typeof program.startTime === 'string' ? new Date(program.startTime) : program.startTime;
      const programEnd = new Date(programStart.getTime() + program.duration);
      
      // Program overlaps with this time slot
      return programStart < slotEnd && programEnd > slotStart;
    });
  };

  // Calculate how many slots a program spans
  const getProgramSpan = (program: Program, slotStart: Date, slotDuration: number) => {
    const programStart = typeof program.startTime === 'string' ? new Date(program.startTime) : program.startTime;
    const programEnd = new Date(programStart.getTime() + program.duration);
    
    const programDuration = programEnd.getTime() - Math.max(programStart.getTime(), slotStart.getTime());
    return Math.ceil(programDuration / slotDuration);
  };

  const groupProgramsByChannel = (programs: Program[]) => {
    const grouped: { [channelNumber: number]: Program[] } = {};
    
    programs.forEach(program => {
      const channelNumber = program.channel.number;
      if (!grouped[channelNumber]) {
        grouped[channelNumber] = [];
      }
      grouped[channelNumber].push(program);
    });
    
    // Sort programs within each channel by start time
    Object.keys(grouped).forEach(channelNumber => {
      grouped[Number(channelNumber)].sort((a, b) => {
        const aTime = typeof a.startTime === 'string' ? new Date(a.startTime) : a.startTime;
        const bTime = typeof b.startTime === 'string' ? new Date(b.startTime) : b.startTime;
        return aTime.getTime() - bTime.getTime();
      });
    });
    
    return grouped;
  };

  const getCurrentlyPlayingProgram = (channelId: string) => {
    const channelPrograms = programsByChannelId.get(channelId) ?? [];
    return (
      channelPrograms.find((program) =>
        isCurrentlyPlaying(program.startTime, program.duration),
      ) ?? null
    );
  };


  // Check if a program is in the past but within catchup window (24h default)
  const isPastProgram = (startTime: string | Date, duration: number) => {
    const start = (typeof startTime === 'string' ? new Date(startTime) : startTime).getTime();
    const end = start + duration;
    return end < currentTime.getTime();
  };

  const isCatchupEligible = useCallback(
    (channelId: string, startTime: string | Date, duration: number) => {
      const catchup = catchupByChannelId.get(channelId);
      if (!catchup?.enabled) {
        return false;
      }
      if (!isPastProgram(startTime, duration)) {
        return false;
      }
      const end =
        (typeof startTime === "string" ? new Date(startTime) : startTime).getTime() +
        duration;
      const catchupWindowMs = catchup.windowHours * 60 * 60 * 1000;
      return currentTime.getTime() - end < catchupWindowMs;
    },
    [catchupByChannelId, currentTime],
  );

  // Launch catchup playback for a past program
  const playCatchup = (channel: { number: number; name: string; icon?: string | null }, programStartTime: string | Date) => {
    const startStr = typeof programStartTime === 'string' ? programStartTime : programStartTime.toISOString();
    setPlayingChannel({ number: channel.number, name: channel.name, icon: channel.icon });
    setIsCatchupMode(true);
    setCatchupTime(startStr);
    setIsPlayerOpen(true);
  };

  const desktopTimeSlots = useMemo(
    () => generateTimeSlots(guideStartTime),
    [guideStartTime],
  );

  const GUIDE_ROW_HEIGHT = 60;
  const GUIDE_VIRTUALIZE_THRESHOLD = 15;

  const handlePlayLive = useCallback((channel: GuideChannel) => {
    setPlayingChannel({
      number: channel.number,
      name: channel.name,
      icon: channel.icon,
    });
    setIsCatchupMode(false);
    setCatchupTime(undefined);
    setIsPlayerOpen(true);
  }, []);

  const handleRegenerateChannel = useCallback(
    (channelId: string) => {
      generateForChannelMutation.mutate({ channelId, hours: 24 });
    },
    [generateForChannelMutation],
  );

  const renderDesktopChannelRow = useCallback(
    (channel: GuideChannel) => (
      <GuideDesktopChannelRow
        channel={channel}
        channelPrograms={programsByChannelId.get(channel.id) ?? []}
        timeSlots={desktopTimeSlots}
        guideStartTime={guideStartTime}
        currentTime={currentTime}
        formatTime={formatTime}
        isCurrentlyPlaying={isCurrentlyPlaying}
        getProgressPercentage={getProgressPercentage}
        isPastProgram={isPastProgram}
        isCatchupEligible={isCatchupEligible}
        onPlayLive={handlePlayLive}
        onPlayCatchup={playCatchup}
        onRegenerate={handleRegenerateChannel}
        isRegeneratePending={generateForChannelMutation.isPending}
      />
    ),
    [
      programsByChannelId,
      desktopTimeSlots,
      guideStartTime,
      currentTime,
      generateForChannelMutation.isPending,
      handlePlayLive,
      handleRegenerateChannel,
      playCatchup,
      isPastProgram,
      isCatchupEligible,
    ],
  );

  function VirtualGuideRow({ index, style }: ListChildComponentProps) {
    const channel = sortedChannels[index];
    if (!channel) {
      return null;
    }
    return <div style={style}>{renderDesktopChannelRow(channel)}</div>;
  }

  // Mobile Timeline View Component
  const MobileGuideView = () => {
    const sortedChannels = channelsQuery.data ? 
      [...channelsQuery.data].sort((a: any, b: any) => a.number - b.number) : [];

    return (
      <div className="space-y-4">
        {sortedChannels.map((channel: any) => {
          const { current, next } = getCurrentAndNextPrograms(channel.id);
          
          return (
            <Card key={channel.id} className="overflow-hidden">
              <CardContent className="p-4">
                {/* Channel Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="px-2 py-1 font-medium">
                      {channel.number}
                    </Badge>
                    {channel.icon && (
                      <img 
                        src={channel.icon} 
                        alt=""
                        className="w-8 h-8 rounded object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-sm leading-tight">
                        {channel.name}
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        setPlayingChannel({ number: channel.number, name: channel.name, icon: channel.icon });
                        setIsCatchupMode(false);
                        setCatchupTime(undefined);
                        setIsPlayerOpen(true);
                      }}
                    >
                        <Play className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      title="Regenerate guide"
                      onClick={() => generateForChannelMutation.mutate({ channelId: channel.id, hours: 24 })}
                      disabled={generateForChannelMutation.isPending}
                    >
                      <Zap className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Current Program */}
                {current ? (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="text-xs font-medium text-green-600 dark:text-green-400">
                        NOW PLAYING
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(current.startTime)} - {formatTime(new Date(
                          (typeof current.startTime === 'string' ? new Date(current.startTime) : current.startTime).getTime() + current.duration
                        ))}
                      </span>
                    </div>
                    
                    <div className="bg-accent/30 rounded-lg p-3">
                      <div className="flex items-start gap-3">
                        {(current.episode?.show.poster || current.movie?.poster) && (
                          <img
                            src={current.episode?.show.poster || current.movie?.poster || ''}
                            alt=""
                            className="w-12 h-16 object-cover rounded flex-shrink-0"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium text-sm leading-tight mb-1">
                            {current.episode ? 
                              `${current.episode.show.title} - S${current.episode.seasonNumber}E${current.episode.episodeNumber}` :
                              current.movie?.title
                            }
                          </h4>
                          {current.episode && (
                            <p className="text-xs text-muted-foreground mb-1">
                              {current.episode.title}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {current.episode ? 'TV Show' : 'Movie'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(current.duration)}
                            </span>
                          </div>
                          
                          {/* Progress Bar */}
                          <div className="mt-2">
                            <div className="h-1 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary transition-all duration-1000"
                                style={{ width: `${getProgressPercentage(current.startTime, current.duration)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 p-3 bg-muted/50 rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">No current program</p>
                  </div>
                )}

                {/* Next Program */}
                {next && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">
                        UP NEXT
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(next.startTime)}
                      </span>
                    </div>
                    
                    <div className="bg-muted/30 rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        {(next.episode?.show.poster || next.movie?.poster) && (
                          <img
                            src={next.episode?.show.poster || next.movie?.poster || ''}
                            alt=""
                            className="w-8 h-10 object-cover rounded flex-shrink-0"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="font-medium text-sm leading-tight">
                            {next.episode ? 
                              `${next.episode.show.title} - S${next.episode.seasonNumber}E${next.episode.episodeNumber}` :
                              next.movie?.title
                            }
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {next.episode ? 'TV Show' : 'Movie'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(next.duration)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Tv className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            TV Guide
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            {isMobileView ? "Current and upcoming programs" : "Traditional TV guide with channels and time slots"}
            <span className="ml-2 text-xs">(Times shown in your timezone: {userTimeZone})</span>
          </p>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            onClick={() => maintainProgramsMutation.mutate({})}
            disabled={maintainProgramsMutation.isPending}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${maintainProgramsMutation.isPending ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button 
            onClick={() => generateProgramsMutation.mutate({})}
            disabled={generateProgramsMutation.isPending}
            size="sm"
          >
            <Zap className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Generate Programs</span>
            <span className="sm:hidden">Generate</span>
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {guideQuery.isLoading ? (
        <div className="space-y-4">
          {[...Array(isMobileView ? 3 : 5)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="animate-pulse">
                  <div className="h-6 bg-muted rounded w-1/4 mb-2"></div>
                  <div className="h-4 bg-muted rounded w-1/3"></div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[...Array(isMobileView ? 2 : 3)].map((_, j) => (
                    <div key={j} className="animate-pulse">
                      <div className="h-16 bg-muted rounded"></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : guideQuery.error ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-destructive">Error loading guide: {guideQuery.error.message}</p>
          </CardContent>
        </Card>
      ) : !guideQuery.data || guideQuery.data.length === 0 ? (
        <Card>
          <CardContent className="p-8 sm:p-12 text-center">
            <Tv className="w-12 h-12 sm:w-16 sm:h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg sm:text-xl font-semibold mb-2">No programs scheduled</h3>
            <p className="text-muted-foreground mb-4 text-sm sm:text-base">
              {channelsQuery.data && channelsQuery.data.length > 0 
                ? "Generate programs for your channels to see the TV guide"
                : "Create some channels and add content to see the TV guide"
              }
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              {channelsQuery.data && channelsQuery.data.length > 0 ? (
                <>
                  <Button 
                    onClick={() => generateProgramsMutation.mutate({})}
                    disabled={generateProgramsMutation.isPending}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    {generateProgramsMutation.isPending ? "Generating..." : "Generate Programs"}
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/channels">
                      <Settings className="w-4 h-4 mr-2" />
                      Manage Channels
                    </Link>
                  </Button>
                </>
              ) : (
                <Button asChild>
                  <Link href="/channels">
                    Create Channels
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Guide Controls */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setGuideStartTime(prev => new Date(prev.getTime() - 3 * 60 * 60 * 1000))}
                    disabled={(() => {
                      const now = new Date();
                      // Allow scrolling back up to 48 hours for catchup
                      const minTime = new Date(now.getTime() - 48 * 60 * 60 * 1000);
                      return guideStartTime <= minTime;
                    })()}
                    className="touch-manipulation"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    <span className="hidden sm:inline">Previous 3h</span>
                    <span className="sm:hidden">-3h</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const now = new Date();
                      const minutes = now.getMinutes();
                      const roundedMinutes = Math.floor(minutes / 30) * 30;
                      now.setMinutes(roundedMinutes, 0, 0);
                      setGuideStartTime(now);
                    }}
                    className="touch-manipulation"
                  >
                    <Clock className="w-4 h-4 mr-1" />
                    Now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setGuideStartTime(prev => new Date(prev.getTime() + 3 * 60 * 60 * 1000))}
                    disabled={(() => {
                      const guideDays = settingsQuery.data?.guideDays || 3;
                      const now = new Date();
                      const maxTime = new Date(now.getTime() + (guideDays * 24 * 60 * 60 * 1000) - (6 * 60 * 60 * 1000));
                      return guideStartTime >= maxTime;
                    })()}
                    className="touch-manipulation"
                  >
                    <span className="hidden sm:inline">Next 3h</span>
                    <span className="sm:hidden">+3h</span>
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">
                  <div className="font-medium text-foreground mb-1">
                    {isMobileView ? formatDate(guideStartTime) : formatDateLong(guideStartTime)}
                  </div>
                  <div className="text-xs sm:text-sm">
                    {isMobileView ? 
                      `${formatTimeShort(guideStartTime)} - ${formatTimeShort(new Date(guideStartTime.getTime() + 6 * 60 * 60 * 1000))}` :
                      `Showing ${formatTime(guideStartTime)} - ${formatTime(new Date(guideStartTime.getTime() + 6 * 60 * 60 * 1000))} (6 hours)`
                    }
                    {settingsQuery.data && (
                      <span className="ml-2 text-xs hidden sm:inline">
                        • Guide configured for {settingsQuery.data.guideDays || 3} days
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mobile Timeline View */}
          {isMobileView ? (
            <MobileGuideView />
          ) : (
            /* Desktop TV Guide Grid */
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <div className="min-w-fit">
                    {/* Time Header */}
                    <div className="flex border-b bg-muted/30">
                      <div className="w-48 p-2 font-semibold border-r bg-background text-sm">Channel</div>
                      <div className="flex-1 flex">
                        {desktopTimeSlots.map((slot, index) => {
                          const isNewDay = index > 0 && slot.getDate() !== desktopTimeSlots[index - 1].getDate();
                          const isFirstSlotOfDay = index === 0 || isNewDay;
                          
                          return (
                            <div key={index} className="flex-1 p-1.5 text-center font-medium border-r text-xs min-w-[80px] max-w-[100px]">
                              {isFirstSlotOfDay && (
                                <div className="text-[10px] text-muted-foreground font-normal mb-1">
                                  {formatDate(slot)}
                                </div>
                              )}
                              <div className={isNewDay ? 'font-bold' : ''}>
                                {formatTime(slot)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Channel Rows */}
                    {sortedChannels.length > 0 ? (
                      sortedChannels.length > GUIDE_VIRTUALIZE_THRESHOLD ? (
                        <List
                          height={Math.min(
                            720,
                            sortedChannels.length * GUIDE_ROW_HEIGHT,
                          )}
                          itemCount={sortedChannels.length}
                          itemSize={GUIDE_ROW_HEIGHT}
                          width="100%"
                        >
                          {VirtualGuideRow}
                        </List>
                      ) : (
                        sortedChannels.map((channel) => (
                          <div key={channel.id}>
                            {renderDesktopChannelRow(channel)}
                          </div>
                        ))
                      )
                    ) : (
                      <div className="p-8 text-center text-muted-foreground">
                        No channels available
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Video Player */}
      {isPlayerOpen && playingChannel && (
        <VideoPlayer
          url=""
          title={playingChannel.name}
          isOpen={isPlayerOpen}
          onClose={() => {
            setIsPlayerOpen(false);
            setPlayingChannel(null);
            setIsCatchupMode(false);
            setCatchupTime(undefined);
          }}
          posterImage={playingChannel.icon || undefined}
          autoPlay={true}
          isLiveTV={!isCatchupMode}
          isCatchup={isCatchupMode}
          catchupTime={catchupTime}
          channelNumber={playingChannel.number}
        />
      )}
    </div>
  );
} 