import { NextRequest, NextResponse } from 'next/server';
import { CatchupService } from '@/lib/catchup-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/catchup
 *
 * Query parameters:
 *   channel   – channel number (required)
 *   time      – ISO-8601 timestamp to seek to
 *   programId – specific program ID (alternative to time)
 *
 * Without time/programId: lists catchup-eligible programs for the channel.
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

    const available = await CatchupService.isCatchupAvailable(channelNumber);
    if (!available) {
      return NextResponse.json(
        { error: 'Catchup is not available for this channel' },
        { status: 404 },
      );
    }

    if (!timeParam && !programIdParam) {
      const programs = await CatchupService.listCatchupPrograms(channelNumber);
      return NextResponse.json({
        channel: channelNumber,
        catchupAvailable: true,
        programs,
      });
    }

    let requestedTime: Date | undefined;
    if (timeParam) {
      requestedTime = new Date(timeParam);
      if (isNaN(requestedTime.getTime())) {
        return NextResponse.json({ error: 'Invalid time parameter' }, { status: 400 });
      }
    }

    const resolved = await CatchupService.resolveCatchupRequest(channelNumber, {
      requestedTime,
      programId: programIdParam ?? undefined,
    });

    if (!resolved) {
      return NextResponse.json(
        { error: 'No program found for the requested time or catchup window has expired' },
        { status: 404 },
      );
    }

    const { program, seekOffsetMs, remainingMs } = resolved;
    const programEnd = new Date(program.startTime.getTime() + program.duration);
    const catchupExpiry =
      program.catchupExpiry ??
      new Date(
        programEnd.getTime() +
          program.channel.catchupWindowHours * 60 * 60 * 1000,
      );

    const forwardedHost =
      request.headers.get('x-forwarded-host') ||
      request.headers.get('host') ||
      'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${forwardedHost}`;
    const playbackTime = resolved.requestedTime.toISOString();
    const videoUrl = `${baseUrl}/api/video?channel=${channelNumber}&catchup=true&time=${encodeURIComponent(playbackTime)}`;

    return NextResponse.json({
      channel: channelNumber,
      programId: program.id,
      programTitle: CatchupService.getProgramTitle(program),
      seekOffset: Math.floor(seekOffsetMs / 1000),
      remainingMs,
      programStartTime: program.startTime.toISOString(),
      programEndTime: programEnd.toISOString(),
      programDurationMs: program.duration,
      videoUrl,
      catchupExpiry: catchupExpiry.toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Catchup API] Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
