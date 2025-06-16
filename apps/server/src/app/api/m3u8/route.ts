import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PlexService } from "@/lib/plex-service";
import { TimingService } from "@/lib/timing-service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const channelParam = searchParams.get('channel');
    const debug = searchParams.get('debug') === 'true';
    
    if (!channelParam) {
      return NextResponse.json({ error: 'Channel parameter is required' }, { status: 400 });
    }

    const channelNumber = parseInt(channelParam, 10);
    
    if (isNaN(channelNumber)) {
      return NextResponse.json({ error: 'Invalid channel number' }, { status: 400 });
    }

    const now = new Date();

    if (debug) {
      console.log(`[M3U8] Generating playlist for channel ${channelNumber} at ${now.toISOString()}`);
    }

    // Get channel with current and upcoming programs
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      include: {
        programs: {
          where: {
            // Get current program and next few programs
            startTime: { 
              gte: new Date(now.getTime() - (2 * 60 * 60 * 1000)), // Include programs from 2 hours ago
              lte: new Date(now.getTime() + (4 * 60 * 60 * 1000))   // Include programs up to 4 hours from now
            },
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
          orderBy: { startTime: 'asc' }
        }
      }
    });

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    // Filter to only relevant programs using TimingService
    const relevantPrograms = TimingService.filterRelevantPrograms(channel.programs, 1, 4, now);

    if (debug) {
      console.log(`[M3U8] Found ${channel.programs.length} total programs, ${relevantPrograms.length} relevant for time window`);
    }

    // Generate M3U8 playlist with proper timing
    let m3u8 = '#EXTM3U\n';
    m3u8 += '#EXT-X-VERSION:3\n';
    m3u8 += '#EXT-X-ALLOW-CACHE:NO\n';
    
    let programCount = 0;
    
    // Add each program as a separate entry with timing-aware URLs
    for (const program of relevantPrograms) {
      const timing = TimingService.calculateSeekOffset(program.startTime, program.duration, now);
      
      // Skip programs that have completely ended
      if (!timing.isActive && timing.remainingMs === 0) {
        if (debug) {
          console.log(`[M3U8] Skipping ended program: ${program.episode?.show?.title || program.movie?.title || 'Unknown'}`);
        }
        continue;
      }
      
      let title = 'Unknown Program';
      let videoUrl = '';
      
      try {
        if (program.episode) {
          const episode = program.episode;
          const server = episode.show.library.server;
          title = `${episode.show.title} - ${episode.title}`;
          
          if (server.type === 'PLEX' && server.token) {
            // Use IP address for IPTV compatibility
            const baseUrl = process.env.BASE_URL || `http://192.168.1.20:3000`;
            videoUrl = `${baseUrl}/api/video?channel=${channelNumber}`;
          }
        } else if (program.movie) {
          const movie = program.movie;
          const server = movie.library.server;
          title = movie.title;
          
          if (server.type === 'PLEX' && server.token) {
            // Use IP address for IPTV compatibility
            const baseUrl = process.env.BASE_URL || `http://192.168.1.20:3000`;
            videoUrl = `${baseUrl}/api/video?channel=${channelNumber}`;
          }
        }
        
        if (videoUrl) {
          const effectiveDuration = TimingService.calculateEffectiveDuration(
            program.startTime, 
            program.duration, 
            now
          );
          
          m3u8 += `#EXTINF:${effectiveDuration},${title}\n`;
          m3u8 += `${videoUrl}\n`;
          programCount++;
          
          if (debug) {
            TimingService.debugTiming(program.startTime, program.duration, title, now);
            console.log(`[M3U8] Added program: ${title} (${effectiveDuration}s effective duration)`);
          }
        } else if (debug) {
          console.log(`[M3U8] No valid stream URL for program: ${title}`);
        }
      } catch (error) {
        console.error(`[M3U8] Error processing program: ${title}`, error);
        if (debug) {
          console.error(`[M3U8] Program details:`, {
            startTime: program.startTime,
            duration: program.duration,
            timing
          });
        }
      }
    }
    
    m3u8 += '#EXT-X-ENDLIST\n';

    if (debug) {
      console.log(`[M3U8] Generated playlist with ${programCount} programs for channel ${channel.name}`);
    }

    return new NextResponse(m3u8, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      }
    });

  } catch (error) {
    console.error('Error generating M3U8:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 