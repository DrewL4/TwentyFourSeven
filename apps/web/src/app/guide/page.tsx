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



  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
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

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Tv className="w-8 h-8 text-blue-600" />
            TV Guide
          </h1>
          <p className="text-muted-foreground mt-1">
            Traditional TV guide with channels and time slots
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => maintainProgramsMutation.mutate({})}
            disabled={maintainProgramsMutation.isPending}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${maintainProgramsMutation.isPending ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            onClick={() => generateProgramsMutation.mutate({})}
            disabled={generateProgramsMutation.isPending}
            size="sm"
          >
            <Zap className="w-4 h-4 mr-1" />
            Generate Programs
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {guideQuery.isLoading ? (
        <div className="space-y-6">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="animate-pulse">
                  <div className="h-6 bg-muted rounded w-1/4 mb-2"></div>
                  <div className="h-4 bg-muted rounded w-1/3"></div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[...Array(3)].map((_, j) => (
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
          <CardContent className="p-12 text-center">
            <Tv className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No programs scheduled</h3>
            <p className="text-muted-foreground mb-4">
              {channelsQuery.data && channelsQuery.data.length > 0 
                ? "Generate programs for your channels to see the TV guide"
                : "Create some channels and add content to see the TV guide"
              }
            </p>
            <div className="flex gap-2 justify-center">
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
        /* Traditional TV Guide Grid */
        <div className="space-y-6">
          {/* Guide Controls */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setGuideStartTime(prev => new Date(prev.getTime() - 3 * 60 * 60 * 1000))}
                    disabled={(() => {
                      const now = new Date();
                      const minTime = new Date(now.getTime() - 4 * 60 * 60 * 1000);
                      return guideStartTime <= minTime;
                    })()}
                    title={`Go to ${formatTime(new Date(guideStartTime.getTime() - 3 * 60 * 60 * 1000))} on ${formatDate(new Date(guideStartTime.getTime() - 3 * 60 * 60 * 1000))}`}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous 3h
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
                    title={`Go to ${formatTime(new Date(guideStartTime.getTime() + 3 * 60 * 60 * 1000))} on ${formatDate(new Date(guideStartTime.getTime() + 3 * 60 * 60 * 1000))}`}
                  >
                    Next 3h
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">
                  <div className="font-medium text-foreground mb-1">
                    {formatDateLong(guideStartTime)}
                  </div>
                  <div>
                    Showing {formatTime(guideStartTime)} - {formatTime(new Date(guideStartTime.getTime() + 6 * 60 * 60 * 1000))} (6 hours)
                    {settingsQuery.data && (
                      <span className="ml-2 text-xs">
                        • Guide configured for {settingsQuery.data.guideDays || 3} days
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* TV Guide Grid */}
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
                                      {/* Current time indicator */}
                                      {isCurrentSlot && (
                                        <div
                                          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20"
                                          style={{
                                            left: `${((currentTime.getTime() - slotStart.getTime()) / slotDuration) * 100}%`
                                          }}
                                        >
                                          <div className="absolute -top-1 -left-1 w-2 h-2 bg-red-500 rounded-full"></div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              
                              {/* Program overlays */}
                              <div className="absolute inset-0">
                                {(() => {
                                  // Process programs for this channel and sort by start time
                                  const sortedPrograms = channelPrograms
                                    .map(program => {
                                      const programStart = typeof program.startTime === 'string' ? new Date(program.startTime) : program.startTime;
                                      const programEnd = new Date(programStart.getTime() + program.duration);
                                      
                                      // Calculate position within the visible time window
                                      const startSlotIndex = Math.floor((programStart.getTime() - guideStartTime.getTime()) / slotDuration);
                                      const endSlotIndex = Math.floor((programEnd.getTime() - guideStartTime.getTime()) / slotDuration);
                                      const spanCount = Math.max(1, endSlotIndex - startSlotIndex + 1);
                                      
                                      return {
                                        ...program,
                                        programStart,
                                        programEnd,
                                        startSlotIndex,
                                        endSlotIndex,
                                        spanCount
                                      };
                                    })
                                    .filter(program => {
                                      // Only include programs that are visible in the current time window
                                      return program.startSlotIndex < timeSlots.length && program.endSlotIndex >= 0;
                                    })
                                    .sort((a, b) => a.programStart.getTime() - b.programStart.getTime());

                                  return sortedPrograms.map(program => {
                                    const isPlaying = isCurrentlyPlaying(program.startTime, program.duration);
                                    
                                    // Calculate the width and position as percentages, with gaps between programs
                                    const startPercent = Math.max(0, (program.startSlotIndex / timeSlots.length) * 100);
                                    const endPercent = Math.min(100, ((program.endSlotIndex + 1) / timeSlots.length) * 100);
                                    const widthPercent = Math.max(1, endPercent - startPercent - 0.5); // Leave 0.5% gap between programs
                                    
                                    // Skip if program is too narrow to be visible
                                    if (widthPercent < 1) return null;
                                    
                                    return (
                                      <div
                                        key={program.id}
                                        className="absolute top-0 bottom-0 p-1"
                                        style={{
                                          left: `${startPercent}%`,
                                          width: `${widthPercent}%`
                                        }}
                                      >
                                        <div
                                          className={`text-xs p-1.5 rounded-lg h-full flex flex-col min-h-[58px] border-2 transition-all duration-200 overflow-hidden relative ${
                                            isPlaying 
                                              ? 'bg-red-100 border-red-400 shadow-lg dark:bg-red-900/40 dark:border-red-500' 
                                              : 'bg-white border-gray-300 hover:border-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:hover:border-gray-500'
                                          }`}
                                        >
                                          {/* Program Content */}
                                          <div className="flex-1 min-h-0">
                                            <div className="font-semibold text-xs leading-tight mb-0.5 truncate">
                                              {program.episode ? program.episode.show.title : program.movie?.title}
                                            </div>
                                            {program.episode ? (
                                              <div className="text-[10px] text-muted-foreground truncate">
                                                S{program.episode.seasonNumber}E{program.episode.episodeNumber}
                                                {program.spanCount > 2 && program.episode.title && (
                                                  <span>: {program.episode.title}</span>
                                                )}
                                              </div>
                                            ) : program.movie?.year && (
                                              <div className="text-[10px] text-muted-foreground">
                                                ({program.movie.year})
                                              </div>
                                            )}
                                          </div>
                                          
                                          {/* Time and Status Info - only show if there's enough space */}
                                          {program.spanCount > 1 && (
                                            <div className="flex items-center justify-between text-[9px] mt-auto border-t border-current/10 pt-0.5">
                                              <span className="text-muted-foreground truncate">
                                                {formatTime(program.programStart)} - {formatTime(program.programEnd)}
                                              </span>
                                              {isPlaying && (
                                                <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                                                  <div className="w-1 h-1 bg-red-500 rounded-full animate-pulse"></div>
                                                  <span className="font-bold text-red-600 dark:text-red-400">LIVE</span>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          

                                          
                                          {/* Live indicator for small programs */}
                                          {isPlaying && program.spanCount === 1 && (
                                            <div className="absolute top-1 right-1">
                                              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  }).filter(Boolean);
                                })()}
                              </div>
                            </div>
                          </div>
                        );
                      })
                  ) : (
                    <div className="flex">
                      <div className="w-40 p-8 border-r">
                        <div className="text-center text-muted-foreground">
                          No channels
                        </div>
                      </div>
                      <div className="flex-1 p-8 text-center text-muted-foreground">
                        No channels configured
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
} 