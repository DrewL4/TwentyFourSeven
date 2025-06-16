import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { TimingService } from '@/lib/timing-service';
import { PlexAPI } from '@/lib/plex';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PassThrough } from 'stream';

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

async function buildFfmpegArgs(streamUrl: string, seekSeconds: number): Promise<string[]> {
    const ffmpegSettings = await prisma.ffmpegSettings.findUnique({
        where: { id: "singleton" },
    });

    if (!ffmpegSettings || !ffmpegSettings.enableTranscoding) {
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

    // Global options
    if (ffmpegSettings.globalOptions) {
        args.push(...ffmpegSettings.globalOptions.split(' '));
    }
    args.push('-loglevel', ffmpegSettings.logLevel || 'error');

    // Hardware acceleration input options
    if (ffmpegSettings.enableHardwareAccel && ffmpegSettings.hardwareAccelType !== 'none') {
        switch (ffmpegSettings.hardwareAccelType) {
            case 'nvenc':
                args.push('-hwaccel', 'cuda'); // or 'cuvid' for older versions
                break;
            case 'qsv':
                args.push('-hwaccel', 'qsv');
                break;
            case 'vaapi':
                args.push('-hwaccel', 'vaapi');
                if (ffmpegSettings.hardwareDevice) {
                    args.push('-vaapi_device', ffmpegSettings.hardwareDevice);
                }
                break;
            case 'videotoolbox':
                args.push('-hwaccel', 'videotoolbox');
                break;
        }
    }
    
    // Input options
    args.push('-ss', `${seekSeconds}`);
    if (ffmpegSettings.inputOptions) {
        args.push(...ffmpegSettings.inputOptions.split(' '));
    }
    args.push('-i', streamUrl);

    // Video options
    args.push('-c:v', ffmpegSettings.videoCodec || 'libx264');
    if (ffmpegSettings.videoBitrate) {
        args.push('-b:v', ffmpegSettings.videoBitrate);
    }
    if (ffmpegSettings.videoBufSize) {
        args.push('-bufsize', ffmpegSettings.videoBufSize);
    }
    if (ffmpegSettings.videoPreset) {
        args.push('-preset', ffmpegSettings.videoPreset);
    }
    if (ffmpegSettings.videoCrf) {
        args.push('-crf', `${ffmpegSettings.videoCrf}`);
    }

    // Video scaling/resolution
    if (ffmpegSettings.targetResolution && ffmpegSettings.targetResolution !== 'original') {
        args.push('-vf', `scale=${ffmpegSettings.targetResolution}`);
    }

    // Audio options
    args.push('-c:a', ffmpegSettings.audioCodec || 'aac');
    if (ffmpegSettings.audioBitrate) {
        args.push('-b:a', ffmpegSettings.audioBitrate);
    }
    if (ffmpegSettings.audioChannels) {
        args.push('-ac', `${ffmpegSettings.audioChannels}`);
    }
     if (ffmpegSettings.audioSampleRate) {
        args.push('-ar', `${ffmpegSettings.audioSampleRate}`);
    }

    // Other options
    if (ffmpegSettings.threads) {
        args.push('-threads', `${ffmpegSettings.threads}`);
    }
    if(ffmpegSettings.maxMuxingQueueSize) {
        args.push('-max_muxing_queue_size', `${ffmpegSettings.maxMuxingQueueSize}`);
    }

    // Output options
    if (ffmpegSettings.outputOptions) {
        args.push(...ffmpegSettings.outputOptions.split(' '));
    }

    args.push('-f', ffmpegSettings.outputFormat || 'mpegts');
    args.push('-'); // Output to stdout

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

    const ffmpegArgs = await buildFfmpegArgs(streamUrl, seekSeconds);

    console.log(`[FFmpeg] Spawning FFmpeg with args: ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    // We need a PassThrough stream to pipe FFmpeg's stdout to the NextResponse
    const passthrough = new PassThrough();
    ffmpeg.stdout.pipe(passthrough);
    
    ffmpeg.stderr.on('data', (data) => {
      console.error(`[FFmpeg] stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
      console.log(`[FFmpeg] process exited with code ${code}`);
      passthrough.end();
    });
    
    request.signal.onabort = () => {
        console.log('[FFmpeg] Client aborted request. Killing FFmpeg.');
        ffmpeg.kill();
    };
    
    return new NextResponse(passthrough as any, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
      },
    });

  } catch (error: any) {
    console.error(`Error streaming video for channel ${channelNumber}:`, error.message);
    return new NextResponse(error.message, { status: 500 });
  }
} 