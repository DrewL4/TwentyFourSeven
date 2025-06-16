import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PlexService } from "@/lib/plex-service";

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

    // Get channel with current program
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      include: {
        programs: {
          where: {
            startTime: { lte: new Date() },
          },
          include: {
            episode: {
              include: { 
                show: {
                  include: {
                    library: {
                      include: { server: true }
                    }
                  }
                }
              }
            },
            movie: {
              include: {
                library: {
                  include: { server: true }
                }
              }
            }
          },
          orderBy: { startTime: 'desc' },
          take: 1
        }
      }
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    // Get current program
    const currentProgram = channel.programs[0];
    
    if (!currentProgram) {
      // No current program, return offline audio content
      return handleOfflineAudio(channel);
    }

    // Handle Plex content streaming (audio-only)
    if (currentProgram.episode) {
      const episode = currentProgram.episode;
      const server = episode.show.library.server;
      
      if (server.type === 'PLEX' && server.token) {
        // Get audio-only stream URL from Plex (using transcoding for audio extraction)
        const streamUrl = PlexService.getStreamUrl(
          server.url, 
          server.token, 
          episode.ratingKey,
          true // Enable transcoding for audio-only stream
        );
        
        // Redirect to Plex audio stream
        return NextResponse.redirect(streamUrl);
      }
    } else if (currentProgram.movie) {
      const movie = currentProgram.movie;
      const server = movie.library.server;
      
      if (server.type === 'PLEX' && server.token) {
        // Get audio-only stream URL from Plex (using transcoding for audio extraction)
        const streamUrl = PlexService.getStreamUrl(
          server.url, 
          server.token, 
          movie.ratingKey,
          true // Enable transcoding for audio-only stream
        );
        
        // Redirect to Plex audio stream
        return NextResponse.redirect(streamUrl);
      }
    }

    // Fallback to offline audio content
    return handleOfflineAudio(channel);

  } catch (error) {
    console.error('Error streaming radio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleOfflineAudio(channel: any) {
  // Return appropriate offline audio response
  const headers = {
    'Content-Type': 'audio/mp2t',
    'Cache-Control': 'no-cache',
  };

  // For now, return a simple response indicating the radio channel is offline
  // In a full implementation, this would generate actual audio content
  return new NextResponse('Radio channel offline', {
    status: 503,
    headers
  });
} 