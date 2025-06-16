import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { TimingService } from '@/lib/timing-service';
import { PlexAPI } from '@/lib/plex';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ number: string }> }
) {
  const params = await context.params;
  const channelNumber = parseInt(params.number, 10);
  if (isNaN(channelNumber)) {
    return new NextResponse('Invalid channel number', { status: 400 });
  }

  const now = new Date();
  
  // This logic is complex, so we'll simplify for now.
  // We need to get the *current* program to calculate the offset.
  const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      include: {
        programs: {
          where: {
            startTime: { lte: now },
            // endTime: { gte: now } // This doesn't work well with duration
          },
          include: {
            episode: { include: { show: { include: { library: { include: { server: true } } } } } },
            movie: { include: { library: { include: { server: true } } } }
          },
          orderBy: { startTime: 'desc' },
          take: 1, // Get the most recent program that has started
        }
      }
    });

  if (!channel || channel.programs.length === 0) {
    // In a real implementation, we would play offline content
    return new NextResponse('Channel or program not found', { status: 404 });
  }

  const currentProgram = channel.programs[0];
  const programEnd = new Date(currentProgram.startTime.getTime() + currentProgram.duration);

  // Check if the program is still active
  if (now > programEnd) {
     return new NextResponse('Program has ended', { status: 404 });
  }

  const timing = TimingService.calculateSeekOffset(currentProgram.startTime, currentProgram.duration, now);
  
  const programInfo = currentProgram.movie ?? currentProgram.episode;
  const server = currentProgram.movie?.library.server ?? currentProgram.episode?.show.library.server;

  if (!programInfo || !server || server.type !== 'PLEX' || !server.token) {
    return new NextResponse('Program or server not configured for Plex streaming', { status: 500 });
  }
  
  const plex = new PlexAPI({ uri: server.url });
  const mediaParts = await plex.getMediaParts(server.url, server.token, programInfo.ratingKey);

  if (!mediaParts?.partKey) {
    return new NextResponse('Could not get media parts from Plex', { status: 500 });
  }

  let streamUrl = `${server.url}${mediaParts.partKey}?X-Plex-Token=${server.token}`;
  if (timing.seekOffsetMs > 0) {
    const seekSeconds = Math.floor(timing.seekOffsetMs / 1000);
    streamUrl += `&t=${seekSeconds}`;
  }

  const title = currentProgram.movie?.title ?? `${currentProgram.episode!.show.title} - ${currentProgram.episode!.title}`;
  // Duration for EXTINF should be the *total* duration of the media file.
  const duration = Math.round(mediaParts.duration / 1000);

  const m3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${duration}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:${duration},${title}
${streamUrl}
#EXT-X-ENDLIST`;

  return new NextResponse(m3u8, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
    },
  });
} 