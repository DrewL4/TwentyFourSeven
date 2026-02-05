import { NextRequest, NextResponse } from 'next/server';
import { CatchupService } from '@/lib/catchup-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/catchup
 *
 * Query parameters:
 *   channel  – channel number (required)
 *   time     – ISO-8601 timestamp to seek to (optional, defaults to start of current program)
 *   programId – specific program ID (optional, alternative to time-based lookup)
 *
 * Returns JSON with catchup stream info or an error.
 */
export async function GET(request: NextRequest) {
  try {
    const channelParam = request.nextUrl.searchParams.get('channel');
    const timeParam = request.nextUrl.searchParams.get('time');
    const programIdParam = request.nextUrl.searchParams.get('programId');

    if (!channelParam) {
      return NextResponse.json({ error: 'channel parameter is required' }, { status: 400 });
    }

    const channelNumber = parseInt(channelParam, 10);
    if (isNaN(channelNumber)) {
      return NextResponse.json({ error: 'Invalid channel number' }, { status: 400 });
    }

    // Check if catchup is available for this channel
    const available = await CatchupService.isCatchupAvailable(channelNumber);
    if (!available) {
      return NextResponse.json(
        { error: 'Catchup is not available for this channel' },
        { status: 404 }
      );
    }

    // If listing mode (no time or programId), return available catchup programs
    if (!timeParam && !programIdParam) {
      const programs = await CatchupService.listCatchupPrograms(channelNumber);
      return NextResponse.json({
        channel: channelNumber,
        catchupAvailable: true,
        programs: programs.map((p) => ({
          id: p.id,
          startTime: p.startTime.toISOString(),
          duration: p.duration,
          title: p.movie
            ? p.movie.title
            : p.episode
              ? `${p.episode.show.title} - S${p.episode.seasonNumber}E${p.episode.episodeNumber}`
              : 'Unknown',
          type: p.movie ? 'movie' : 'episode',
          poster: p.movie?.poster ?? p.episode?.show?.poster ?? null,
        })),
      });
    }

    // Resolve the requested time
    let requestedTime: Date;
    if (timeParam) {
      requestedTime = new Date(timeParam);
      if (isNaN(requestedTime.getTime())) {
        return NextResponse.json({ error: 'Invalid time parameter' }, { status: 400 });
      }
    } else {
      // If programId provided, look up the program's start time
      const program = await CatchupService.getProgramById(programIdParam!);
      if (!program) {
        return NextResponse.json({ error: 'Program not found or no longer available for catchup' }, { status: 404 });
      }
      requestedTime = program.startTime;
    }

    // Get catchup stream info
    const info = await CatchupService.getCatchupStreamInfo(channelNumber, requestedTime);
    if (!info) {
      return NextResponse.json(
        { error: 'No program found for the requested time or catchup window has expired' },
        { status: 404 }
      );
    }

    // Build the video URL for the client (uses the /api/video endpoint with catchup params)
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${forwardedHost}`;
    const videoUrl = `${baseUrl}/api/video?channel=${channelNumber}&catchup=true&time=${requestedTime.toISOString()}`;

    return NextResponse.json({
      channel: channelNumber,
      programId: info.programId,
      programTitle: info.programTitle,
      seekOffset: info.seekSeconds,
      remainingMs: info.remainingMs,
      programStartTime: info.programStartTime.toISOString(),
      programDuration: info.programDuration,
      videoUrl,
      expiresAt: new Date(
        info.programStartTime.getTime() + info.programDuration
      ).toISOString(),
    });
  } catch (error: any) {
    console.error('[Catchup API] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
