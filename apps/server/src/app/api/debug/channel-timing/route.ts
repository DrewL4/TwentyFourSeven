import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TimingService } from "@/lib/timing-service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channelParam = searchParams.get('channel');
    
    if (!channelParam) {
      return NextResponse.json({ error: 'Channel parameter is required' }, { status: 400 });
    }

    const channelNumber = parseInt(channelParam, 10);
    
    if (isNaN(channelNumber)) {
      return NextResponse.json({ error: 'Invalid channel number' }, { status: 400 });
    }

    const now = new Date();

    // Get channel with programs
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      include: {
        programs: {
          where: {
            startTime: { 
              gte: new Date(now.getTime() - (4 * 60 * 60 * 1000)), // Include programs from 4 hours ago
              lte: new Date(now.getTime() + (8 * 60 * 60 * 1000))   // Include programs up to 8 hours from now
            },
          },
          include: {
            episode: {
              include: { 
                show: true
              }
            },
            movie: true
          },
          orderBy: { startTime: 'asc' }
        }
      }
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    // Get current program
    const currentProgram = TimingService.getCurrentProgram(channel.programs, now);

    // Analyze all programs
    const programAnalysis = channel.programs.map(program => {
      const timing = TimingService.calculateSeekOffset(program.startTime, program.duration, now);
      const title = program.episode 
        ? `${program.episode.show.title} - ${program.episode.title}`
        : program.movie?.title || 'Unknown';
      
      return {
        title,
        startTime: program.startTime.toISOString(),
        endTime: new Date(program.startTime.getTime() + program.duration).toISOString(),
        duration: TimingService.formatDuration(program.duration),
        timing: {
          isActive: timing.isActive,
          seekOffsetMs: timing.seekOffsetMs,
          seekOffsetFormatted: TimingService.formatDuration(timing.seekOffsetMs),
          remainingMs: timing.remainingMs,
          remainingFormatted: TimingService.formatDuration(timing.remainingMs)
        },
        isCurrent: currentProgram?.id === program.id
      };
    });

    return NextResponse.json({
      channel: {
        number: channel.number,
        name: channel.name
      },
      currentTime: now.toISOString(),
      currentProgram: currentProgram ? {
        title: currentProgram.episode 
          ? `${currentProgram.episode.show.title} - ${currentProgram.episode.title}`
          : currentProgram.movie?.title || 'Unknown',
        startTime: currentProgram.startTime.toISOString(),
        timing: TimingService.calculateSeekOffset(currentProgram.startTime, currentProgram.duration, now)
      } : null,
      allPrograms: programAnalysis,
      totalPrograms: channel.programs.length
    });

  } catch (error) {
    console.error('Error in channel timing debug:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 