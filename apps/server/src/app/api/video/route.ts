import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { TimingService } from '@/lib/timing-service';
import { PlexAPI } from '@/lib/plex';
import { spawn, ChildProcess } from 'child_process';
import { PassThrough } from 'stream';
import { streamMonitorService } from '@/lib/stream-monitor-service';
import { streamRecoveryService } from '@/lib/stream-recovery-service';
import { viewingHistoryService } from '@/lib/viewing-history-service';

// This is a requirement for using readable streams in a NextResponse.
export const dynamic = 'force-dynamic';

async function getProgramInfo(channelNumber: number) {
  const now = new Date();
  const channel = await prisma.channel.findUnique({
    where: { number: channelNumber },
    include: {
      programs: {
        where: { startTime: { lte: now } },
        include: {
          episode: { include: { show: { include: { library: { include: { server: true } } } } } },
          movie: { include: { library: { include: { server: true } } } },
        },
        orderBy: { startTime: 'desc' },
        take: 1,
      },
    },
  });

  if (!channel || channel.programs.length === 0) {
    throw new Error('Channel or program not found');
  }

  const currentProgram = channel.programs[0];
  const programEnd = new Date(currentProgram.startTime.getTime() + currentProgram.duration);

  if (now > programEnd) {
    throw new Error('Program has ended');
  }

  const timing = TimingService.calculateSeekOffset(currentProgram.startTime, currentProgram.duration, now);
  const programInfo = currentProgram.movie ?? currentProgram.episode;
  const server = currentProgram.movie?.library.server ?? currentProgram.episode?.show.library.server;

  if (!programInfo || !server || server.type !== 'PLEX' || !server.token) {
    throw new Error('Program or server not configured for Plex streaming');
  }

  return { programInfo, server, timing };
}

async function buildFfmpegArgs(streamUrl: string, seekSeconds: number, options?: { forceSoftware?: boolean }): Promise<string[]> {
    const ffmpegSettings = await prisma.ffmpegSettings.findUnique({
        where: { id: "singleton" },
    });

    const forceSoftware = options?.forceSoftware === true;

    // Smart fallback: use environment detection if database settings not available
    const useEnvironmentFallback = !ffmpegSettings;
    const enableTranscoding = ffmpegSettings?.enableTranscoding ?? true; // Default to enabled

    if (!enableTranscoding && !useEnvironmentFallback) {
        return [
            '-loglevel', 'error',
            '-ss', `${seekSeconds}`,
            '-i', streamUrl,
            '-c', 'copy',
            '-f', 'mpegts',
            '-'
        ];
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

  try {
    const { programInfo, server, timing } = await getProgramInfo(channelNumber);
    
    if (!server.token) {
      return new NextResponse('Plex server token is missing.', { status: 500 });
    }

    const plex = new PlexAPI({ uri: server.url });
    const mediaParts = await plex.getMediaParts(server.url, server.token, programInfo.ratingKey);

    if (!mediaParts?.partKey) {
      return new NextResponse('Could not get media parts from Plex', { status: 500 });
    }

    const streamUrl = `${server.url}${mediaParts.partKey}?X-Plex-Token=${server.token}`;
    const seekSeconds = timing.seekOffsetMs > 0 ? Math.floor(timing.seekOffsetMs / 1000) : 0;

    // Get client IP for session tracking
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     request.headers.get('x-real-ip') || 
                     undefined;

    // Get channel info for viewing history
    const channel = await prisma.channel.findUnique({
      where: { number: channelNumber },
      select: { name: true },
    });

    // Get program title (movie or episode)
    let programTitle: string | undefined;
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

    // Create stream session for monitoring
    const sessionId = streamMonitorService.createSession(
      channelNumber,
      { ratingKey: programInfo.ratingKey },
      clientIp
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
    const passthrough = new PassThrough();

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
      /initializ/i,
      /failed/i,
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

    const startFfmpeg = async (forceSoftware: boolean) => {
      if (isAborted) {
        return null;
      }

      const currentSession = streamMonitorService.getSession(sessionId);
      if (!currentSession) {
        return null;
      }

      // Use session metadata for stream URL and seek
      const activeStreamUrl = currentSession.streamUrl || streamUrl;
      const activeSeekSeconds = currentSession.seekSeconds || seekSeconds;

      const ffmpegArgs = await buildFfmpegArgs(activeStreamUrl, activeSeekSeconds, { forceSoftware });
      
      const child = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      
      // Update session with FFmpeg process
      streamMonitorService.setFfmpegProcess(sessionId, child);
      
      // Track output activity (event-driven monitoring)
      child.stdout.on('data', () => {
        streamMonitorService.updateOutputActivity(sessionId);
      });
      
      child.stdout.pipe(passthrough, { end: false });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        
        
        // Track activity on stderr output as well
        streamMonitorService.updateActivity(sessionId);

        // Detect errors and classify them
        const hasGpuError = gpuErrorPatterns.some((p) => p.test(text));
        const hasNetworkError = networkErrorPatterns.some((p) => p.test(text));
        const hasCodecError = codecErrorPatterns.some((p) => p.test(text));

        // GPU error: try software fallback first (legacy behavior)
        if (!restartedToSoftware && hasGpuError) {
          restartedToSoftware = true;
          
          streamMonitorService.addError(sessionId, `GPU error: ${text.substring(0, 100)}`);
          streamMonitorService.updateSessionMetadata(sessionId, { restartedToSoftware: true });
          
          try { 
            child.kill('SIGKILL'); 
          } catch {}
          
          // Start software fallback
          startFfmpeg(true).catch((err) => {
            
            streamMonitorService.addError(sessionId, `Software fallback failed: ${err.message}`);
            streamMonitorService.updateStatus(sessionId, 'failed');
            passthrough.end();
          });
          return;
        }

        // Network or codec errors: attempt recovery via recovery service
        if (hasNetworkError || hasCodecError) {
          const errorType = hasNetworkError ? 'Network error' : 'Codec error';
          const errorMessage = `${errorType}: ${text.substring(0, 100)}`;
          
          streamMonitorService.addError(sessionId, errorMessage);
          
          // Attempt recovery (will check limits and circuit breaker internally)
          streamRecoveryService.attemptRecovery(sessionId, errorMessage, buildFfmpegArgs)
            .then((result) => {
              if (result.success && result.process) {
                // Recovery succeeded - update process reference
                streamMonitorService.setFfmpegProcess(sessionId, result.process);
                if (result.process.stdout) {
                  result.process.stdout.on('data', () => {
                    streamMonitorService.updateOutputActivity(sessionId);
                  });
                  result.process.stdout.pipe(passthrough, { end: false });
                }
                currentFfmpeg = result.process;
              } else {
                // Recovery failed
                
                streamMonitorService.updateStatus(sessionId, 'failed');
                passthrough.end();
              }
            })
            .catch((err) => {
              
              streamMonitorService.updateStatus(sessionId, 'failed');
              passthrough.end();
            });
        }
      });

      child.on('error', (error) => {
        
        streamMonitorService.addError(sessionId, `Process error: ${error.message}`);
        
        // Attempt recovery for process errors
        if (!isAborted) {
          streamRecoveryService.attemptRecovery(sessionId, error.message, buildFfmpegArgs)
            .then((result) => {
              if (result.success && result.process) {
                streamMonitorService.setFfmpegProcess(sessionId, result.process);
                if (result.process.stdout) {
                  result.process.stdout.on('data', () => {
                    streamMonitorService.updateOutputActivity(sessionId);
                  });
                  result.process.stdout.pipe(passthrough, { end: false });
                }
                currentFfmpeg = result.process;
              } else {
                streamMonitorService.updateStatus(sessionId, 'failed');
                passthrough.end();
              }
          });
        }
      });

      child.on('close', (code) => {
        
        
        // Ignore if this is an old process (we already restarted)
        if (!currentFfmpeg || currentFfmpeg.pid !== child.pid) {
          return;
        }

        // If process exited with error and haven't tried software fallback
        if (code !== 0 && !restartedToSoftware && !isAborted) {
          restartedToSoftware = true;
          
          streamMonitorService.addError(sessionId, `FFmpeg exited with code ${code}`);
          streamMonitorService.updateSessionMetadata(sessionId, { restartedToSoftware: true });
          
          startFfmpeg(true).catch((err) => {
            
            streamMonitorService.addError(sessionId, `Software fallback failed: ${err.message}`);
            streamMonitorService.updateStatus(sessionId, 'failed');
            passthrough.end();
          });
          return;
        }

        // Normal end (client abort or final process finished)
        if (!isAborted) {
          streamMonitorService.updateStatus(sessionId, 'failed');
          
          // Get error details from stream monitor
          const session = streamMonitorService.getSession(sessionId);
          const errorMessage = session?.lastError || 'Stream ended unexpectedly';
          const errorDetails = session ? {
            lastError: session.lastError,
            errorHistory: session.errorHistory,
            recoveryAttempts: session.recoveryAttempts,
            status: session.status,
          } : undefined;
          
          // Record session end with failed status
          viewingHistoryService.recordSessionEnd(
            sessionId,
            'failed',
            errorMessage,
            errorDetails
          ).catch((error) => {
            console.error('[Video] Failed to record session end:', error);
          });
        }
        passthrough.end();
      });

      currentFfmpeg = child;
      return child;
    };

    // Start with hardware (if available)
    await startFfmpeg(false);

    // Handle client abort
    request.signal.addEventListener('abort', () => {
      isAborted = true;
      
      try { 
        currentFfmpeg?.kill('SIGKILL'); 
      } catch {}
      
      // Record session end
      const session = streamMonitorService.getSession(sessionId);
      viewingHistoryService.recordSessionEnd(
        sessionId,
        'completed',
        'Client disconnected',
        session ? {
          lastError: session.lastError,
          errorHistory: session.errorHistory,
          recoveryAttempts: session.recoveryAttempts,
          status: session.status,
        } : undefined
      ).catch((error) => {
        console.error('[Video] Failed to record session end:', error);
      });
      
      streamMonitorService.removeSession(sessionId);
      streamRecoveryService.cleanup(sessionId);
    });
    
    return new NextResponse(passthrough as any, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
      },
    });

  } catch (error: any) {
    
    return new NextResponse(error.message, { status: 500 });
  }
} 