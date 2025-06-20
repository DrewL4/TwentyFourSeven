"use client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tv, Clock, Calendar, Play, Film, RefreshCw, Zap, Settings, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";

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
  const queryClient = useQueryClient();
  
  const guideQuery = useQuery(orpc.guide.current.queryOptions());
  const channelsQuery = useQuery(orpc.channels.list.queryOptions());
  const settingsQuery = useQuery(orpc.settings.get.queryOptions());

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
    if (!guideQuery.data) return { current: null, next: null };
    
    const channelPrograms = guideQuery.data
      .filter((program: Program) => program.channel.id === channelId)
      .sort((a: Program, b: Program) => {
        const aTime = typeof a.startTime === 'string' ? new Date(a.startTime) : a.startTime;
        const bTime = typeof b.startTime === 'string' ? new Date(b.startTime) : b.startTime;
        return aTime.getTime() - bTime.getTime();
      });

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
    if (!guideQuery.data) return null;
    
    return guideQuery.data.find((program: Program) => {
      return program.channel.id === channelId && isCurrentlyPlaying(program.startTime, program.duration);
    });
  };

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
                    <Button variant="ghost" size="sm" asChild className="h-8 w-8 p-0">
                      <Link href={`/player?channel=${channel.number}`}>
                        <Play className="w-4 h-4" />
                      </Link>
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
                      const minTime = new Date(now.getTime() - 4 * 60 * 60 * 1000);
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
                        {generateTimeSlots(guideStartTime).map((slot, index) => {
                          const isNewDay = index > 0 && slot.getDate() !== generateTimeSlots(guideStartTime)[index - 1].getDate();
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
                    {channelsQuery.data && channelsQuery.data.length > 0 ? (
                      (channelsQuery.data as any[])
                        .sort((a, b) => a.number - b.number)
                        .map((channel) => {
                          const channelPrograms = guideQuery.data?.filter((p: Program) => p.channel.id === channel.id) || [];
                          const timeSlots = generateTimeSlots(guideStartTime);
                          const slotDuration = 30 * 60 * 1000;
                          
                          return (
                            <div key={channel.id} className="flex border-b hover:bg-muted/20 min-h-[60px]">
                              {/* Channel Info */}
                              <div className="w-48 p-2 border-r bg-background sticky left-0 z-10 flex items-center">
                                <div className="flex items-center gap-2 w-full">
                                  <Badge variant="outline" className="text-xs px-1.5 py-0.5 flex-shrink-0">
                                    {channel.number}
                                  </Badge>
                                  {channel.icon && (
                                    <img 
                                      src={channel.icon} 
                                      alt=""
                                      className="w-6 h-6 rounded object-cover flex-shrink-0"
                                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p
                                      className="font-medium text-xs leading-tight whitespace-nowrap overflow-hidden relative group"
                                      title={channel.name}
                                    >
                                      <span
                                        className="inline-block min-w-full will-change-transform group-hover:animate-marquee"
                                        style={{ display: 'inline-block' }}
                                      >
                                        {channel.name}
                                      </span>
                                      <style jsx global>{`
                                        @keyframes marquee {
                                          0% { transform: translateX(0); }
                                          100% { transform: translateX(calc(-100% + 12rem)); }
                                        }
                                        .group:hover .group-hover\\:animate-marquee {
                                          animation: marquee 4s linear infinite;
                                        }
                                      `}</style>
                                    </p>
                                  </div>
                                  <Button variant="ghost" size="sm" asChild className="flex-shrink-0 h-6 w-6 p-0">
                                    <Link href={`/player?channel=${channel.number}`}>
                                      <Play className="w-3 h-3" />
                                    </Link>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex-shrink-0 h-6 w-6 p-0"
                                    title="Regenerate this channel's guide"
                                    onClick={() => generateForChannelMutation.mutate({ channelId: channel.id, hours: 24 })}
                                    disabled={generateForChannelMutation.isPending}
                                  >
                                    <Zap className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>

                              {/* Time Slots */}
                              <div className="flex-1 relative">
                                <div className="flex relative">
                                  {timeSlots.map((slotStart, slotIndex) => {
                                    const slotEnd = new Date(slotStart.getTime() + slotDuration);
                                    const isCurrentSlot = currentTime >= slotStart && currentTime < slotEnd;
                                    
                                    return (
                                      <div
                                        key={slotIndex}
                                        className={`flex-1 border-r min-h-[60px] relative min-w-[80px] max-w-[100px] ${
                                          isCurrentSlot ? 'bg-blue-50 dark:bg-blue-950/30' : ''
                                        }`}
                                      >
                                      </div>
                                    );
                                  })}
                                </div>
                                
                                {/* Current time indicator - positioned precisely */}
                                {(() => {
                                  const guideEnd = new Date(guideStartTime.getTime() + (6 * 60 * 60 * 1000));
                                  const isWithinGuideWindow = currentTime >= guideStartTime && currentTime <= guideEnd;
                                  
                                  if (isWithinGuideWindow) {
                                    const timeOffset = currentTime.getTime() - guideStartTime.getTime();
                                    const totalDuration = 6 * 60 * 60 * 1000; // 6 hours
                                    const leftPercent = (timeOffset / totalDuration) * 100;
                                    
                                    return (
                                      <div
                                        className="absolute top-0 w-px h-full bg-blue-500 z-30"
                                        style={{ left: `${leftPercent}%` }}
                                      >
                                        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-blue-500 rounded-full"></div>
                                        <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-blue-500 text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
                                          {formatTime(currentTime)}
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                                
                                {/* Programs */}
                                <div className="absolute inset-0 flex">
                                  {channelPrograms.map((program: Program) => {
                                    const programStart = typeof program.startTime === 'string' ? new Date(program.startTime) : program.startTime;
                                    const programEnd = new Date(programStart.getTime() + program.duration);
                                    const guideEnd = new Date(guideStartTime.getTime() + (6 * 60 * 60 * 1000));
                                    
                                    // Skip programs that don't overlap with our time window
                                    if (programEnd <= guideStartTime || programStart >= guideEnd) return null;
                                    
                                    // Calculate position and width
                                    const startOffset = Math.max(0, programStart.getTime() - guideStartTime.getTime());
                                    const endOffset = Math.min(guideEnd.getTime() - guideStartTime.getTime(), programEnd.getTime() - guideStartTime.getTime());
                                    const totalDuration = 6 * 60 * 60 * 1000; // 6 hours
                                    
                                    const leftPercent = (startOffset / totalDuration) * 100;
                                    const widthPercent = ((endOffset - startOffset) / totalDuration) * 100;
                                    
                                    const isCurrentProgram = isCurrentlyPlaying(program.startTime, program.duration);
                                    const isShortProgram = program.duration <= (30 * 60 * 1000); // 30 minutes or less
                                    const hourDuration = 60 * 60 * 1000; // 1 hour in milliseconds
                                    
                                    // Calculate expanded width for short programs (make them as wide as 1 hour show)
                                    const expandedWidthPercent = isShortProgram ? 
                                      (hourDuration / (6 * 60 * 60 * 1000)) * 100 : widthPercent;
                                    
                                    return (
                                      <div
                                        key={program.id}
                                        className={`absolute top-1 bottom-1 mx-0.5 rounded text-xs overflow-visible cursor-pointer transition-all duration-300 hover:z-50 hover:shadow-2xl group ${
                                          isCurrentProgram 
                                            ? 'bg-blue-500 text-white border-2 border-blue-600' 
                                            : 'bg-accent text-accent-foreground border border-border'
                                        }`}
                                        style={{
                                          left: `${leftPercent}%`,
                                          width: `${widthPercent}%`,
                                          transformOrigin: 'left center',
                                          '--expanded-width': `${expandedWidthPercent}%`
                                        } as React.CSSProperties & { '--expanded-width': string }}
                                        title={`${program.episode ? 
                                          `${program.episode.show.title} - S${program.episode.seasonNumber}E${program.episode.episodeNumber}: ${program.episode.title}` :
                                          program.movie?.title
                                        } (${formatTime(program.startTime)} - ${formatTime(programEnd)})`}
                                        onMouseEnter={(e) => {
                                          if (isShortProgram) {
                                            e.currentTarget.style.width = `${expandedWidthPercent}%`;
                                          }
                                        }}
                                        onMouseLeave={(e) => {
                                          if (isShortProgram) {
                                            e.currentTarget.style.width = `${widthPercent}%`;
                                          }
                                        }}
                                      >
                                        {/* Regular content - visible by default */}
                                        <div className={`p-1.5 h-full overflow-hidden ${isShortProgram ? 'group-hover:hidden' : ''}`}>
                                          <div className="font-medium leading-tight line-clamp-1">
                                            {program.episode ? program.episode.show.title : program.movie?.title}
                                          </div>
                                          {program.episode && (
                                            <div className="text-[10px] opacity-75 line-clamp-1">
                                              S{program.episode.seasonNumber}E{program.episode.episodeNumber}
                                            </div>
                                          )}
                                          <div className="text-[10px] opacity-75">
                                            {formatTime(program.startTime)}
                                          </div>
                                          {isCurrentProgram && (
                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
                                              <div 
                                                className="h-full bg-white transition-all duration-1000"
                                                style={{ width: `${getProgressPercentage(program.startTime, program.duration)}%` }}
                                              />
                                            </div>
                                          )}
                                        </div>

                                        {/* Expanded hover content - only visible on hover for short programs */}
                                        {isShortProgram && (
                                          <div className="absolute inset-0 p-2 hidden group-hover:flex bg-inherit rounded border-2 border-primary/20 shadow-lg">
                                            <div className="flex flex-col justify-center space-y-1 w-full text-center">
                                              <div className="font-bold text-sm leading-tight">
                                                {program.episode ? program.episode.show.title : program.movie?.title}
                                              </div>
                                              {program.episode && (
                                                <>
                                                  <div className="text-xs opacity-90 font-medium">
                                                    S{program.episode.seasonNumber}E{program.episode.episodeNumber}
                                                  </div>
                                                  {program.episode.title && (
                                                    <div className="text-xs opacity-85 font-medium leading-tight">
                                                      "{program.episode.title}"
                                                    </div>
                                                  )}
                                                </>
                                              )}
                                              {program.movie?.year && (
                                                <div className="text-xs opacity-90 font-medium">
                                                  ({program.movie.year})
                                                </div>
                                              )}
                                              <div className="text-xs opacity-80 font-medium">
                                                {formatTime(program.startTime)} - {formatTime(programEnd)}
                                              </div>
                                              <div className="text-xs opacity-80 font-medium">
                                                {formatDuration(program.duration)}
                                              </div>
                                              {isCurrentProgram && (
                                                <div className="mt-1">
                                                  <div className="h-1.5 bg-black/20 dark:bg-white/20 rounded-full overflow-hidden mx-2">
                                                    <div 
                                                      className="h-full bg-white dark:bg-white transition-all duration-1000"
                                                      style={{ width: `${getProgressPercentage(program.startTime, program.duration)}%` }}
                                                    />
                                                  </div>
                                                  <div className="text-[10px] text-center mt-1 opacity-80 font-medium">
                                                    {Math.round(getProgressPercentage(program.startTime, program.duration))}% complete
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })
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
    </div>
  );
} 