import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { TimingService } from '@/lib/timing-service';
import { PlexAPI } from '@/lib/plex';
import { spawn, ChildProcess } from 'child_process';
import { PassThrough } from 'stream';
import { streamMonitorService } from '@/lib/stream-monitor-service';
import { streamRecoveryService } from '@/lib/stream-recovery-service';
import { viewingHistoryService } from '@/lib/viewing-history-service';
import { CatchupService } from '@/lib/catchup-service';
import { shouldRejectNewTranscode } from '@/lib/stream-limit';
import { finalizeStreamSession } from '@/lib/finalize-stream-session';
import {
  sharedLiveTranscodePool,
  type SharedLiveHub,
} from '@/lib/shared-live-transcode';
import { loadLiveProgramForChannel } from '@/lib/resolve-live-program';
import {
  buildLiveFfmpegArgs,
  initialEncodeMode,
  nextLiveEncodeMode,
  type LiveEncodeMode,
} from '@/lib/ffmpeg-live-args';

// This is a requirement for using readable streams in a NextResponse.
export const dynamic = 'force-dynamic';

const MPEGTS_RESPONSE_HEADERS = {
  'Content-Type': 'video/mp2t',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  'X-Accel-Buffering': 'no',
};

/** Next.js Node-stream piping logs `failed to pipe response` on IPTV aborts. */
function asMpegTsBody(passthrough: PassThrough): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const closeQuietly = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      passthrough.on('data', (chunk: Buffer) => {
        try {
          controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        } catch {
          // closed
        }
      });
      passthrough.on('end', closeQuietly);
      passthrough.on('error', (err: NodeJS.ErrnoException) => {
        if (
          err?.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
          err?.name === 'AbortError' ||
          err?.message === 'Premature close'
        ) {
          closeQuietly();
          return;
        }
        try {
          controller.error(err);
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (!passthrough.destroyed) {
        passthrough.destroy();
      }
    },
  });
}

const LIVE_HANDOFF_ATTEMPTS = 12;
const LIVE_HANDOFF_RETRY_MS = 500;
const FFMPEG_SETTINGS_TTL_MS = 15_000;

type CachedFfmpegSettings = Awaited<ReturnType<typeof prisma.ffmpegSettings.findUnique>>;

let ffmpegSettingsCache: { expires: number; row: CachedFfmpegSettings } | null = null;

async function loadFfmpegSettings(): Promise<CachedFfmpegSettings> {
  const now = Date.now();
  if (ffmpegSettingsCache && ffmpegSettingsCache.expires > now) {
    return ffmpegSettingsCache.row;
  }
  const row = await prisma.ffmpegSettings.findUnique({
    where: { id: 'singleton' },
  });
  ffmpegSettingsCache = { expires: now + FFMPEG_SETTINGS_TTL_MS, row };
  return row;
}

async function getProgramInfo(channelNumber: number) {
  const live = await loadLiveProgramForChannel(channelNumber);
  if (!live) {
    throw new Error('Channel or program not found');
  }
  return live;
}

async function buildFfmpegArgs(
  streamUrl: string,
  seekSeconds: number,
  options?: {
    forceSoftware?: boolean;
    discontinuity?: boolean;
    mode?: LiveEncodeMode;
    fallback?: boolean;
    copy?: boolean;
  },
): Promise<string[]> {
  const ffmpegSettings = await loadFfmpegSettings();
  const mode: LiveEncodeMode = options?.forceSoftware
    ? 'software'
    : options?.mode ?? 'hardware';
  return buildLiveFfmpegArgs(
    streamUrl,
    seekSeconds,
    ffmpegSettings,
    {
      mode,
      discontinuity: options?.discontinuity,
      fallback: options?.forceSoftware === true || options?.fallback === true,
      copy: options?.copy === true,
    },
    {
      hwaccelMethod: process.env.FFMPEG_HWACCEL_METHOD,
      hardwareDevice: process.env.HARDWARE_ACCEL_DEVICE,
    },
  );
}


export async function GET(request: NextRequest) {
  const channelParam = request.nextUrl.searchParams.get('channel');
  if (!channelParam) {
    return new NextResponse('Channel parameter is required', { status: 400 });
  }
  const channelNumber = parseInt(channelParam, 10);
  if (isNaN(channelNumber)) {
    return new NextResponse('Invalid channel number', { status: 400 });
  }

  // ── Catchup / Timeshift support ──
  // Catchup requests arrive with `catchup=true` and one of:
  //   • `time`  – ISO-8601 timestamp
  //   • `utc`   – Unix epoch seconds (IPTV player standard)
  //   • `lutc`  – "live" Unix epoch (current wall-clock when player made request)
  const isCatchup = request.nextUrl.searchParams.get('catchup') === 'true';
  const useCopyRemux = request.nextUrl.searchParams.get('copy') === '1';
  const timeParam = request.nextUrl.searchParams.get('time');
  const utcParam = request.nextUrl.searchParams.get('utc');
  const lutcParam = request.nextUrl.searchParams.get('lutc');
  const programIdParam = request.nextUrl.searchParams.get('programId');

  try {
    let programInfo: any;
    let server: any;
    let timing: { seekOffsetMs: number; isActive: boolean; remainingMs: number };
    let catchupProgramTitle: string | undefined;
    let liveProgramTitle: string | undefined;
    let channelName: string | undefined;
    let liveProgramId: string | undefined;
    let resolvedStreamUrl: string | undefined;
    let resolvedSeekSeconds: number | undefined;
    const streamSettingsPromise = prisma.settings.findUnique({
      where: { id: 'singleton' },
      select: { concurrentStreams: true },
    });

    if (isCatchup) {
      let requestedTime: Date | undefined;
      if (timeParam) {
        requestedTime = new Date(timeParam);
        if (isNaN(requestedTime.getTime())) {
          return new NextResponse('Invalid time value', { status: 400 });
        }
      } else if (utcParam || lutcParam) {
        const utcSeconds = parseInt((utcParam || lutcParam) as string, 10);
        if (isNaN(utcSeconds)) {
          return new NextResponse('Invalid utc value', { status: 400 });
        }
        requestedTime = new Date(utcSeconds * 1000);
      } else if (!programIdParam) {
        return new NextResponse(
          'Catchup requires time, utc, or programId',
          { status: 400 },
        );
      }

      const resolved = await CatchupService.resolveCatchupRequest(channelNumber, {
        requestedTime,
        programId: programIdParam ?? undefined,
      });

      if (!resolved) {
        return new NextResponse(
          'No catchup program found for the requested time or catchup is disabled',
          { status: 404 },
        );
      }

      const { program, seekOffsetMs, remainingMs } = resolved;
      const media = program.movie ?? program.episode;
      const srv =
        program.movie?.library?.server ??
        program.episode?.show?.library?.server;

      if (!media || !srv?.token) {
        return new NextResponse('Catchup program or Plex server unavailable', { status: 500 });
      }

      programInfo = media;
      server = srv;
      catchupProgramTitle = CatchupService.getProgramTitle(program);
      timing = {
        seekOffsetMs,
        isActive: true,
        remainingMs,
      };
    } else {
      // Standard live playback
      const liveInfo = await getProgramInfo(channelNumber);
      programInfo = liveInfo.programInfo;
      server = liveInfo.server;
      timing = liveInfo.timing;
      liveProgramId = liveInfo.programId;
      resolvedStreamUrl = liveInfo.streamUrl;
      resolvedSeekSeconds = liveInfo.seekSeconds;
      liveProgramTitle = liveInfo.programTitle;
      channelName = liveInfo.channelName;
    }

    // ── From here, the rest of the pipeline is shared between live and catchup ──
    
    if (!server.token) {
      return new NextResponse('Plex server token is missing.', { status: 500 });
    }

    let streamUrl = resolvedStreamUrl;
    if (!streamUrl) {
      const plex = new PlexAPI({ uri: server.url });
      const mediaParts = await plex.getMediaParts(server.url, server.token, programInfo.ratingKey);

      if (!mediaParts?.partKey) {
        return new NextResponse('Could not get media parts from Plex', { status: 500 });
      }

      streamUrl = `${server.url}${mediaParts.partKey}?X-Plex-Token=${server.token}`;
    }
    if (!streamUrl) {
      return new NextResponse('Could not get media parts from Plex', { status: 500 });
    }
    let seekSeconds =
      resolvedSeekSeconds ??
      (timing.seekOffsetMs > 0 ? Math.floor(timing.seekOffsetMs / 1000) : 0);

    // Get client IP for session tracking
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     request.headers.get('x-real-ip') || 
                     undefined;

    // Channel name and title come from the live resolver. Catchup and any
    // miss still look them up for viewing history.
    if (!channelName) {
      const channel = await prisma.channel.findUnique({
        where: { number: channelNumber },
        select: { name: true },
      });
      channelName = channel?.name;
    }

    let programTitle: string | undefined = catchupProgramTitle || liveProgramTitle;
    if (!programTitle) {
      const currentProgram = (await prisma.channel.findUnique({
        where: { number: channelNumber },
        include: {
          programs: {
            where: { startTime: { lte: new Date() } },
            include: {
              movie: true,
              episode: { include: { show: true } },
            },
            orderBy: { startTime: 'desc' },
            take: 1,
          },
        },
      }))?.programs[0];

      if (currentProgram?.movie) {
        programTitle = currentProgram.movie.title;
      } else if (currentProgram?.episode) {
        programTitle = `${currentProgram.episode.show.title} - ${currentProgram.episode.title || 'Episode'}`;
      }
    }

    streamMonitorService.cleanupStaleSessions();
    const streamSettings = await streamSettingsPromise;
    const streamLimit = streamSettings?.concurrentStreams ?? 1;
    if (
      shouldRejectNewTranscode(
        streamMonitorService.getActiveSessions(),
        channelNumber,
        programInfo.ratingKey,
        streamLimit,
        !isCatchup,
        useCopyRemux,
      )
    ) {
      return NextResponse.json(
        {
          error: `Maximum concurrent streams (${streamLimit}) reached. Try again later.`,
        },
        { status: 503 },
      );
    }

    // Create stream session for monitoring
    const sessionId = streamMonitorService.createSession(
      channelNumber,
      { ratingKey: programInfo.ratingKey },
      clientIp,
      { sharedLive: !isCatchup, copyRemux: useCopyRemux },
    );

    // Update session metadata
    streamMonitorService.updateSessionMetadata(sessionId, {
      streamUrl,
      seekSeconds,
      restartedToSoftware: false,
    });

    // Check if IP is blocked before starting session
    if (clientIp) {
      try {
        const isBlocked = await viewingHistoryService.isIpBlocked(clientIp);
        if (isBlocked) {
          streamMonitorService.dropSession(sessionId);
          return NextResponse.json(
            { error: 'Access denied: IP address is blocked' },
            { status: 403 }
          );
        }
      } catch (error) {
        // Don't block on check errors, but log them
        console.error('[Video] Error checking IP block status:', error);
      }

      // Record viewing session start
      viewingHistoryService.recordSessionStart(
        sessionId,
        clientIp,
        channelNumber,
        channelName,
        programTitle
      ).catch((error: any) => {
        if (error.message?.includes('blocked')) {
          // IP was blocked during recordSessionStart
          return NextResponse.json(
            { error: 'Access denied: IP address is blocked' },
            { status: 403 }
          );
        }
        // Don't block streaming on history logging errors
      });
    }

    // Shared passthrough for the lifetime of the HTTP response
    const passthrough = new PassThrough({
      highWaterMark: useCopyRemux ? 1024 * 256 : 1024 * 64,
    });
    const useSharedLive = !isCatchup;

    let liveHub: SharedLiveHub | null = null;
    let shouldStartFfmpeg = true;

    if (useSharedLive) {
      const joined = await sharedLiveTranscodePool.joinOrCreateLiveHub({
        channelNumber,
        ratingKey: programInfo.ratingKey,
        sessionId,
        streamUrl,
        seekSeconds,
        passthrough,
        copy: useCopyRemux,
      });
      liveHub = joined.hub;
      shouldStartFfmpeg = joined.shouldStartFfmpeg;

      if (!shouldStartFfmpeg) {
        if (liveHub.ffmpeg) {
          streamMonitorService.setFfmpegPidForSessions(
            [...liveHub.viewers.keys()],
            liveHub.ffmpeg,
          );
        }

        let joinerFinalized = false;
        const endJoinerSession = () => {
          if (joinerFinalized) {
            return;
          }
          joinerFinalized = true;
          const session = streamMonitorService.getSession(sessionId);
          viewingHistoryService
            .recordSessionEnd(
              sessionId,
              'completed',
              'Client disconnected',
              session
                ? {
                    lastError: session.lastError,
                    errorHistory: session.errorHistory,
                    recoveryAttempts: session.recoveryAttempts,
                    status: session.status,
                  }
                : undefined,
            )
            .catch((error) => {
              console.error('[Video] Failed to record session end:', error);
            });
          finalizeStreamSession(sessionId, { killFfmpeg: true });
        };

        request.signal.addEventListener('abort', endJoinerSession);
        passthrough.on('close', endJoinerSession);
        passthrough.on('error', endJoinerSession);

        return new NextResponse(asMpegTsBody(passthrough) as any, {
          status: 200,
          headers: MPEGTS_RESPONSE_HEADERS,
        });
      }
    }

    // Enhanced error patterns for better error detection
    const gpuErrorPatterns = [
      /nvenc/i,
      /cuInit/i,
      /cuda/i,
      /qsv/i,
      /vaapi/i,
      /videotoolbox/i,
      /No such device/i,
      /device not present/i,
      /resource temporarily unavailable/i,
      /CUDA_ERROR/i,
      /nvenc error/i,
    ];

    // Enhanced error patterns for network/codec/file errors
    const networkErrorPatterns = [
      /network/i,
      /timeout/i,
      /connection/i,
      /ECONNREFUSED/i,
      /ENOTFOUND/i,
      /ETIMEDOUT/i,
    ];

    const codecErrorPatterns = [
      /codec/i,
      /encoder/i,
      /decoder/i,
      /unsupported/i,
      /Invalid data/i,
    ];

    let restartedToSoftware = false;
    let encodeMode: LiveEncodeMode = 'hardware';
    let preferredMode: LiveEncodeMode = 'hardware';
    let encoderStepInFlight = false;
    let currentFfmpeg: ChildProcess | null = null;
    let isAborted = false;
    let sessionFinalized = false;
    let mpegtsDiscontinuity = false;
    const ignoredClosePids = new Set<number>();

    const syncFfmpegToSessions = (child: ChildProcess | null) => {
      if (liveHub) {
        streamMonitorService.setFfmpegPidForSessions(
          [...liveHub.viewers.keys()],
          child,
        );
        streamMonitorService.setFfmpegProcess(liveHub.ownerSessionId, child);
      } else {
        streamMonitorService.setFfmpegProcess(sessionId, child);
      }
    };

    const ignoreClose = (proc: ChildProcess) => {
      if (proc.pid != null) {
        ignoredClosePids.add(proc.pid);
      }
    };

    const beginLiveEncoderGap = () => {
      if (liveHub) {
        sharedLiveTranscodePool.beginEncoderGap(liveHub);
      }
    };

    const markSoftwareEncode = () => {
      restartedToSoftware = true;
      streamMonitorService.updateSessionMetadata(sessionId, { restartedToSoftware: true });
      if (liveHub) {
        sharedLiveTranscodePool.setRestartedToSoftware(liveHub, true);
      }
    };

    /**
     * hardware (GPU decode + GPU encode) → cpu-decode (GPU encode only)
     * → software (cheap libx264). Skipping straight to libx264 burns CPU
     * when NVENC itself is fine and only CUDA decode failed.
     */
    const stepDownEncoder = (reason: string) => {
      if (useCopyRemux) {
        streamMonitorService.addError(sessionId, reason);
        failOpenStream();
        return;
      }
      if (encoderStepInFlight || isAborted) {
        return;
      }
      const next = nextLiveEncodeMode(encodeMode);
      if (!next) {
        streamMonitorService.addError(sessionId, reason);
        failOpenStream();
        return;
      }
      encoderStepInFlight = true;
      encodeMode = next;
      mpegtsDiscontinuity = true;
      streamMonitorService.addError(sessionId, `${reason}; retrying ${next}`);
      if (next === 'software') {
        markSoftwareEncode();
      }
      beginLiveEncoderGap();
      startFfmpeg(next).catch((err) => {
        streamMonitorService.addError(sessionId, `Encoder fallback failed: ${err.message}`);
        failOpenStream();
      });
    };

    const fallBackToSoftware = (reason: string) => {
      if (useCopyRemux) {
        streamMonitorService.addError(sessionId, reason);
        failOpenStream();
        return;
      }
      if (encoderStepInFlight || isAborted || encodeMode === 'software') {
        return;
      }
      encoderStepInFlight = true;
      encodeMode = 'software';
      mpegtsDiscontinuity = true;
      markSoftwareEncode();
      streamMonitorService.addError(sessionId, reason);
      beginLiveEncoderGap();
      startFfmpeg('software').catch((err) => {
        streamMonitorService.addError(sessionId, `Encoder fallback failed: ${err.message}`);
        failOpenStream();
      });
    };

    const failOpenStream = () => {
      streamMonitorService.updateStatus(sessionId, 'failed');
      if (liveHub) {
        sharedLiveTranscodePool.dissolveHub(liveHub, { killFfmpeg: false });
        liveHub = null;
      } else {
        passthrough.end();
      }
      endStreamSession({ killFfmpeg: false });
    };

    function bindFfmpegLifecycle(child: ChildProcess) {
      if (liveHub) {
        sharedLiveTranscodePool.attachFfmpeg(liveHub, child);
        syncFfmpegToSessions(child);
        child.stdout?.on('data', () => {
          const hub = liveHub;
          if (!hub) {
            return;
          }
          for (const viewerSessionId of hub.viewers.keys()) {
            streamMonitorService.updateOutputActivity(viewerSessionId);
          }
        });
      } else {
        streamMonitorService.setFfmpegProcess(sessionId, child);
        child.stdout?.on('data', () => {
          streamMonitorService.updateOutputActivity(sessionId);
        });
        child.stdout?.pipe(passthrough, { end: false });
      }

      child.stderr?.on('data', (data) => {
        const text = data.toString();
        if (useCopyRemux) {
          const line = text.replace(/\s+/g, ' ').trim().slice(0, 400);
          if (line) {
            console.warn(`[Video] copy ffmpeg channel=${channelNumber}: ${line}`);
          }
        }
        const hasGpuError = gpuErrorPatterns.some((p) => p.test(text));
        const hasNetworkError = networkErrorPatterns.some((p) => p.test(text));
        const hasCodecError = codecErrorPatterns.some((p) => p.test(text));

        if (/unknown encoder/i.test(text)) {
          ignoreClose(child);
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          fallBackToSoftware(`Encoder unavailable: ${text.substring(0, 100)}`);
          return;
        }

        if (encodeMode !== 'software' && hasGpuError) {
          ignoreClose(child);
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          stepDownEncoder(`GPU error: ${text.substring(0, 100)}`);
          return;
        }

        if (hasNetworkError || hasCodecError) {
          const errorType = hasNetworkError ? 'Network error' : 'Codec error';
          const errorMessage = `${errorType}: ${text.substring(0, 100)}`;
          streamMonitorService.addError(sessionId, errorMessage);
          ignoreClose(child);
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          if (useCopyRemux) {
            failOpenStream();
            return;
          }
          beginLiveEncoderGap();
          mpegtsDiscontinuity = true;
          streamRecoveryService
            .attemptRecovery(sessionId, errorMessage, buildFfmpegArgs)
            .then((result) => {
              if (result.success && result.process) {
                bindFfmpegLifecycle(result.process);
              } else {
                failOpenStream();
              }
            })
            .catch(() => {
              failOpenStream();
            });
        }
      });

      child.on('error', (error) => {
        streamMonitorService.addError(sessionId, `Process error: ${error.message}`);
        if (isAborted) {
          return;
        }
        ignoreClose(child);
        if (useCopyRemux) {
          failOpenStream();
          return;
        }
        beginLiveEncoderGap();
        mpegtsDiscontinuity = true;
        streamRecoveryService
          .attemptRecovery(sessionId, error.message, buildFfmpegArgs)
          .then((result) => {
            if (result.success && result.process) {
              bindFfmpegLifecycle(result.process);
            } else {
              failOpenStream();
            }
          });
      });

      child.on('close', (code) => {
        if (child.pid != null && ignoredClosePids.delete(child.pid)) {
          return;
        }
        if (!currentFfmpeg || currentFfmpeg.pid !== child.pid) {
          return;
        }

        if (code !== 0 && !isAborted && useCopyRemux) {
          streamMonitorService.addError(sessionId, `FFmpeg remux exited with code ${code}`);
          failOpenStream();
          return;
        }

        if (code !== 0 && !isAborted && encodeMode !== 'software') {
          stepDownEncoder(`FFmpeg exited with code ${code}`);
          return;
        }

        // Live 24/7: the current file ended. Keep the MPEG-TS connection and
        // start the next episode instead of dropping the client.
        if (!isAborted && useSharedLive) {
          beginLiveEncoderGap();
          continueLiveToNextProgram()
            .then((continued) => {
              if (continued || isAborted) {
                return;
              }
              finishCurrentLiveStream(code);
            })
            .catch(() => {
              finishCurrentLiveStream(code);
            });
          return;
        }

        finishCurrentLiveStream(code);
      });

      currentFfmpeg = child;
    }

    const endStreamSession = (options?: { killFfmpeg?: boolean }) => {
      if (sessionFinalized) {
        return;
      }
      sessionFinalized = true;
      if (liveHub && options?.killFfmpeg !== false) {
        sharedLiveTranscodePool.dissolveHub(liveHub, { killFfmpeg: true });
        liveHub = null;
        streamMonitorService.dropSession(sessionId);
        streamRecoveryService.cleanup(sessionId);
        return;
      }
      if (options?.killFfmpeg !== false) {
        try {
          currentFfmpeg?.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      finalizeStreamSession(sessionId, {
        killFfmpeg: options?.killFfmpeg ?? true,
      });
    };

    const finishCurrentLiveStream = (code: number | null) => {
      if (isAborted) {
        return;
      }
      const session = streamMonitorService.getSession(sessionId);
      const historyStatus = code === 0 ? 'completed' : 'failed';
      const errorMessage =
        code === 0
          ? 'Stream completed'
          : session?.lastError || 'Stream ended unexpectedly';
      const errorDetails = session
        ? {
            lastError: session.lastError,
            errorHistory: session.errorHistory,
            recoveryAttempts: session.recoveryAttempts,
            status: session.status,
          }
        : undefined;

      viewingHistoryService
        .recordSessionEnd(
          sessionId,
          historyStatus,
          errorMessage,
          errorDetails,
        )
        .catch((error) => {
          console.error('[Video] Failed to record session end:', error);
        });
      if (liveHub) {
        sharedLiveTranscodePool.dissolveHub(liveHub, { killFfmpeg: false });
        liveHub = null;
      } else {
        passthrough.end();
      }
      endStreamSession({ killFfmpeg: false });
    };

    const continueLiveToNextProgram = async (): Promise<boolean> => {
      if (isAborted || !useSharedLive) {
        return false;
      }
      const skipProgramId = liveProgramId;
      for (let attempt = 0; attempt < LIVE_HANDOFF_ATTEMPTS; attempt++) {
        if (isAborted) {
          return false;
        }
        const next = await loadLiveProgramForChannel(channelNumber, {
          skipProgramId,
        });
        if (!next || next.programId === skipProgramId) {
          await new Promise((resolve) => setTimeout(resolve, LIVE_HANDOFF_RETRY_MS));
          continue;
        }
        liveProgramId = next.programId;
        programInfo = next.programInfo;
        streamUrl = next.streamUrl;
        seekSeconds = next.seekSeconds;
        const metadata = {
          programInfo: next.programInfo,
          streamUrl: next.streamUrl,
          seekSeconds: next.seekSeconds,
        };
        if (liveHub) {
          for (const viewerSessionId of liveHub.viewers.keys()) {
            streamMonitorService.updateSessionMetadata(viewerSessionId, metadata);
          }
          sharedLiveTranscodePool.updateHubProgram(liveHub, {
            ratingKey: next.programInfo.ratingKey,
            streamUrl: next.streamUrl,
            seekSeconds: next.seekSeconds,
          });
        } else {
          streamMonitorService.updateSessionMetadata(sessionId, metadata);
        }
        mpegtsDiscontinuity = true;
        const child = await startFfmpeg(encodeMode);
        return child !== null;
      }
      return false;
    };

    async function startFfmpeg(mode: LiveEncodeMode) {
      if (isAborted) {
        return null;
      }

      const currentSession = streamMonitorService.getSession(sessionId);
      if (!currentSession) {
        return null;
      }

      const activeStreamUrl = currentSession.streamUrl || streamUrl;
      if (!activeStreamUrl) {
        return null;
      }
      const activeSeekSeconds = currentSession.seekSeconds || seekSeconds;

      encodeMode = mode;
      encoderStepInFlight = false;
      const fallingBack = !useCopyRemux && mode === 'software' && preferredMode !== 'software';
      const ffmpegArgs = await buildFfmpegArgs(activeStreamUrl, activeSeekSeconds, {
        mode,
        fallback: fallingBack,
        discontinuity: mpegtsDiscontinuity,
        copy: useCopyRemux,
      });

      const child = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (liveHub && fallingBack) {
        sharedLiveTranscodePool.setRestartedToSoftware(liveHub, true);
      }
      bindFfmpegLifecycle(child);
      return child;
    }

    const ffmpegSettingsForMode = await loadFfmpegSettings();
    preferredMode = useCopyRemux
      ? 'software'
      : !ffmpegSettingsForMode || ffmpegSettingsForMode.enableTranscoding === false
        ? 'software'
        : initialEncodeMode(ffmpegSettingsForMode.videoCodec);
    encodeMode = preferredMode;
    await startFfmpeg(encodeMode);
    console.log(
      `[Video] start channel=${channelNumber} mode=${useCopyRemux ? 'copy' : 'transcode'} encode=${encodeMode} session=${sessionId}${isCatchup ? ' catchup' : ''}`,
    );

    // Handle client abort / stream close (IPTV clients often drop without a
    // clean abort — passthrough close must still reclaim FFmpeg).
    let clientGoneHandled = false;
    const onClientGone = () => {
      if (clientGoneHandled) {
        return;
      }
      clientGoneHandled = true;

      const session = streamMonitorService.getSession(sessionId);
      viewingHistoryService
        .recordSessionEnd(
          sessionId,
          'completed',
          'Client disconnected',
          session
            ? {
                lastError: session.lastError,
                errorHistory: session.errorHistory,
                recoveryAttempts: session.recoveryAttempts,
                status: session.status,
              }
            : undefined,
        )
        .catch((error) => {
          console.error('[Video] Failed to record session end:', error);
        });

      // Owner disconnect with other viewers: hand off hub, do not kill FFmpeg.
      // Keep this request's FFmpeg event handlers alive so recovery/close still
      // serve remaining viewers until the shared process exits.
      if (liveHub && liveHub.viewers.size > 1) {
        sessionFinalized = true;
        finalizeStreamSession(sessionId, { killFfmpeg: true });
        return;
      }

      isAborted = true;
      endStreamSession({ killFfmpeg: true });
    };

    request.signal.addEventListener('abort', onClientGone);
    passthrough.on('close', onClientGone);
    passthrough.on('error', onClientGone);
    
    return new NextResponse(asMpegTsBody(passthrough) as any, {
      status: 200,
      headers: MPEGTS_RESPONSE_HEADERS,
    });

  } catch (error: any) {
    
    return new NextResponse(error.message, { status: 500 });
  }
} 