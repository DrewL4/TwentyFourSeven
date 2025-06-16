import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PlexAPI } from "@/lib/plex";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channelParam = searchParams.get('channel');
    const ratingKey = searchParams.get('ratingKey');
    const seekSeconds = parseInt(searchParams.get('t') || '0', 10);

    if (!channelParam || !ratingKey) {
      return NextResponse.json({ error: 'Channel and ratingKey parameters are required' }, { status: 400 });
    }

    const channelNumber = parseInt(channelParam, 10);
    
    if (isNaN(channelNumber)) {
      return NextResponse.json({ error: 'Invalid channel number' }, { status: 400 });
    }

    // Get channel to find the server
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      include: {
        programs: {
          where: {
            OR: [
              { movieId: { not: null } },
              { episodeId: { not: null } }
            ]
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
          take: 1
        }
      }
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    // Find the server from any program (they should all use the same server for a channel)
    const program = channel.programs[0];
    if (!program) {
      return NextResponse.json({ error: 'No programs found' }, { status: 404 });
    }

    const server = program.episode?.show?.library?.server || program.movie?.library?.server;
    if (!server || server.type !== 'PLEX') {
      return NextResponse.json({ error: 'No Plex server found' }, { status: 404 });
    }

    const plex = new PlexAPI({ uri: server.url });
    
    try {
      // Get media parts
      const mediaParts = await plex.getMediaParts(server.url, server.token!, ratingKey);
      
      if (!mediaParts?.partKey) {
        return NextResponse.json({ error: 'Media parts not found' }, { status: 404 });
      }

      // Build direct file URL with seek
      let streamUrl = `${server.url}${mediaParts.partKey}?X-Plex-Token=${server.token}`;
      
      if (seekSeconds > 0) {
        streamUrl += `&t=${seekSeconds}`;
      }

      console.log(`[StreamProxy] Resolved: ${ratingKey} -> ${streamUrl}`);

      // Redirect to the direct file stream
      return NextResponse.redirect(streamUrl);
      
    } catch (error) {
      console.error('Error resolving stream:', error);
      return NextResponse.json({ error: 'Failed to resolve stream' }, { status: 500 });
    }

  } catch (error) {
    console.error('Error in stream proxy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 