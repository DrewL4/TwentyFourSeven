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

// This is a requirement for using readable streams in a NextResponse.
export const dynamic = 'force-dynamic';

const MPEGTS_RESPONSE_HEADERS = {
  'Content-Type': 'video/mp2t',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  'X-Accel-Buffering': 'no',
};

const LIVE_HANDOFF_ATTEMPTS = 12;
const LIVE_HANDOFF_RETRY_MS = 500;

async function getProgramInfo(channelNumber: number) {
  const live = await loadLiveProgramForChannel(channelNumber);
  if (!live) {
    throw new Error('Channel or program not found');
  }
  return live;
}

async function buildFfmpegArgs(streamUrl: string, seekSeconds: number, options?: { forceSoftware?: boolean; discontinuity?: boolean }): Promise<string[]> {
    const ffmpegSettings = await prisma.ffmpegSettings.findUnique({
        where: { id: "singleton" },
    });

    const forceSoftware = options?.forceSoftware === true;

    // Smart fallback: use environment detection if database settings not available
    const useEnvironmentFallback = !ffmpegSettings;
    const enableTranscoding = ffmpegSettings?.enableTranscoding ?? true; // Default to enabled

    if (!enableTranscoding && !useEnvironmentFallback) {
        const args = [
            '-loglevel', 'error',
            '-ss', `${seekSeconds}`,
            '-i', streamUrl,
            '-c', 'copy',
            '-f', 'mpegts',
        ];
        if (options?.discontinuity) {
            args.push('-mpegts_flags', '+resend_headers+initial_discontinuity');
        }
        args.push('-');
        return args;
    }

    const args: string[] = [];

    // Smart hardware acceleration detection
    const enableHardwareAccel = !forceSoftware && (useEnvironmentFallback ? 
        (process.env.FFMPEG_HWACCEL_METHOD && process.env.FFMPEG_HWACCEL_METHOD !== 'none' && process.env.FFMPEG_HWACCEL_METHOD !== 'cpu') : 
        (ffmpegSettings?.enableHardwareAccel && ffmpegSettings?.hardwareAccelType !== 'none'));
    
    const hardwareAccelType = !forceSoftware ? (useEnvironmentFallback ? 
        process.env.FFMPEG_HWACCEL_METHOD : 
        ffmpegSettings?.hardwareAccelType) : 'none';

    // Global options
    if (ffmpegSettings?.globalOptions) {
        args.push(...ffmpegSettings.globalOptions.split(' '));
    }
    args.push('-loglevel', ffmpegSettings?.logLevel || 'error');

    // Hardware acceleration input options
    if (enableHardwareAccel && hardwareAccelType !== 'none') {
        switch (hardwareAccelType) {
            case 'nvenc':
                args.push('-hwaccel', 'cuda');
                break;
            case 'qsv':
                args.push('-hwaccel', 'qsv');
                break;
            case 'vaapi':
                args.push('-hwaccel', 'vaapi');
                const hardwareDevice = ffmpegSettings?.hardwareDevice || process.env.HARDWARE_ACCEL_DEVICE;
                if (hardwareDevice) {
                    args.push('-vaapi_device', hardwareDevice);
                }
                break;
            case 'videotoolbox':
                args.push('-hwaccel', 'videotoolbox');
                break;
        }
    }
    
    // Input options
    args.push('-ss', `${seekSeconds}`);
    args.push('-probesize', '32768');
    args.push('-analyzeduration', '500000');
    args.push('-fflags', '+genpts+discardcorrupt+nobuffer');
    args.push('-flags', 'low_delay');
    if (ffmpegSettings?.inputOptions) {
        args.push(...ffmpegSettings.inputOptions.split(' '));
    }
    args.push('-i', streamUrl);

    // Video codec selection with smart fallbacks
    let videoCodec: string;
    if (forceSoftware) {
        videoCodec = 'libx264';
    } else if (useEnvironmentFallback) {
        // Environment-based codec selection
        switch (hardwareAccelType) {
            case 'nvenc': videoCodec = 'h264_nvenc'; break;
            case 'qsv': videoCodec = 'h264_qsv'; break;
            case 'vaapi': videoCodec = 'h264_vaapi'; break;
            case 'videotoolbox': videoCodec = 'h264_videotoolbox'; break;
            default: videoCodec = 'libx264'; // CPU fallback
        }
    } else {
        // Database settings
        videoCodec = ffmpegSettings?.videoCodec || 'libx264';
    }
        
    args.push('-c:v', videoCodec);
    
    if (ffmpegSettings?.videoBitrate) {
        args.push('-b:v', ffmpegSettings.videoBitrate);
    } else if (useEnvironmentFallback && !forceSoftware) {
        args.push('-b:v', '8000k'); // Default for hardware acceleration
    }
    
    if (ffmpegSettings?.videoBufSize) {
        args.push('-bufsize', ffmpegSettings.videoBufSize);
    } else if (useEnvironmentFallback && !forceSoftware) {
        args.push('-bufsize', '16000k'); // Default for hardware acceleration
    }
    
    if (ffmpegSettings?.videoPreset) {
        args.push('-preset', ffmpegSettings.videoPreset);
    } else if (useEnvironmentFallback) {
        // Environment-based preset selection
        switch (hardwareAccelType) {
            case 'nvenc': args.push('-preset', 'p4'); break; // NVENC preset
            case 'qsv': args.push('-preset', 'fast'); break; // QSV preset
            case 'vaapi': args.push('-preset', 'fast'); break; // VAAPI preset
            default: args.push('-preset', 'fast'); break; // CPU preset
        }
    }
    
    if (ffmpegSettings?.videoCrf) {
        args.push('-crf', `${ffmpegSettings.videoCrf}`);
    }

    // Video scaling/resolution
    if (ffmpegSettings?.targetResolution && ffmpegSettings.targetResolution !== 'original') {
        args.push('-vf', `scale=${ffmpegSettings.targetResolution}`);
    }

    // Audio options
    args.push('-c:a', ffmpegSettings?.audioCodec || 'aac');
    if (ffmpegSettings?.audioBitrate) {
        args.push('-b:a', ffmpegSettings.audioBitrate);
    }
    if (ffmpegSettings?.audioChannels) {
        args.push('-ac', `${ffmpegSettings.audioChannels}`);
    }
    if (ffmpegSettings?.audioSampleRate) {
        args.push('-ar', `${ffmpegSettings.audioSampleRate}`);
    }

    // Other options
    if (ffmpegSettings?.threads) {
        args.push('-threads', `${ffmpegSettings.threads}`);
    }
    if (ffmpegSettings?.maxMuxingQueueSize) {
        args.push('-max_muxing_queue_size', `${ffmpegSettings.maxMuxingQueueSize}`);
    }

    // Output options
    if (ffmpegSettings?.outputOptions) {
        args.push(...ffmpegSettings.outputOptions.split(' '));
    }

    args.push('-f', ffmpegSettings?.outputFormat || 'mpegts');
    args.push('-flush_packets', '1');
    args.push('-muxdelay', '0');
    args.push('-muxpreload', '0');
    if (options?.discontinuity) {
        args.push('-mpegts_flags', '+resend_headers+initial_discontinuity');
    }
    args.push('-'); // Output to stdout

    // Log the transcoding method being used
    if (useEnvironmentFallback) {
        
    } else {
        
    }

    return args;
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
  const timeParam = request.nextUrl.searchParams.get('time');
  const utcParam = request.nextUrl.searchParams.get('utc');
  const lutcParam = request.nextUrl.searchParams.get('lutc');
  const programIdParam = request.nextUrl.searchParams.get('programId');

  try {
    let programInfo: any;
    let server: any;
    let timing: { seekOffsetMs: number; isActive: boolean; remainingMs: number };
    let catchupProgramTitle: string | undefined;
    let liveProgramId: string | undefined;
    let resolvedStreamUrl: string | undefined;
    let resolvedSeekSeconds: number | undefined;

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

    // Get channel info for viewing history
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      select: { name: true },
    });

    let programTitle: string | undefined = catchupProgramTitle;
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
    const streamSettings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { concurrentStreams: true },
    });
    const streamLimit = streamSettings?.concurrentStreams ?? 1;
    if (
      shouldRejectNewTranscode(
        streamMonitorService.getActiveSessions(),
        channelNumber,
        programInfo.ratingKey,
        streamLimit,
        !isCatchup,
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
      { sharedLive: !isCatchup },
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
        channel?.name,
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
    const passthrough = new PassThrough({ highWaterMark: 1024 * 256 });
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

        return new NextResponse(passthrough as any, {
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
          for (const viewerSessionId of liveHub!.viewers.keys()) {
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
        const hasGpuError = gpuErrorPatterns.some((p) => p.test(text));
        const hasNetworkError = networkErrorPatterns.some((p) => p.test(text));
        const hasCodecError = codecErrorPatterns.some((p) => p.test(text));

        if (!restartedToSoftware && hasGpuError) {
          restartedToSoftware = true;
          mpegtsDiscontinuity = true;
          streamMonitorService.addError(sessionId, `GPU error: ${text.substring(0, 100)}`);
          streamMonitorService.updateSessionMetadata(sessionId, { restartedToSoftware: true });
          if (liveHub) {
            sharedLiveTranscodePool.setRestartedToSoftware(liveHub, true);
          }
          ignoreClose(child);
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          beginLiveEncoderGap();
          startFfmpeg(true).catch((err) => {
            streamMonitorService.addError(sessionId, `Software fallback failed: ${err.message}`);
            failOpenStream();
          });
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

        if (code !== 0 && !restartedToSoftware && !isAborted) {
          restartedToSoftware = true;
          mpegtsDiscontinuity = true;
          streamMonitorService.addError(sessionId, `FFmpeg exited with code ${code}`);
          streamMonitorService.updateSessionMetadata(sessionId, { restartedToSoftware: true });
          if (liveHub) {
            sharedLiveTranscodePool.setRestartedToSoftware(liveHub, true);
          }
          beginLiveEncoderGap();
          startFfmpeg(true).catch((err) => {
            streamMonitorService.addError(sessionId, `Software fallback failed: ${err.message}`);
            failOpenStream();
          });
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
        const child = await startFfmpeg(restartedToSoftware);
        return child !== null;
      }
      return false;
    };

    async function startFfmpeg(forceSoftware: boolean) {
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

      const ffmpegArgs = await buildFfmpegArgs(activeStreamUrl, activeSeekSeconds, {
        forceSoftware,
        discontinuity: mpegtsDiscontinuity,
      });

      const child = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (liveHub && forceSoftware) {
        sharedLiveTranscodePool.setRestartedToSoftware(liveHub, true);
      }
      bindFfmpegLifecycle(child);
      return child;
    }

    // Start with hardware (if available)
    await startFfmpeg(false);

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
    
    return new NextResponse(passthrough as any, {
      status: 200,
      headers: MPEGTS_RESPONSE_HEADERS,
    });

  } catch (error: any) {
    
    return new NextResponse(error.message, { status: 500 });
  }
} 