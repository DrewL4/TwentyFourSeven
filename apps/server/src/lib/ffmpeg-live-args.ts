/**
 * Live MPEG-TS FFmpeg arguments.
 *
 * Hardware codecs (hevc_nvenc, h264_qsv, …) must not be given libx264-only
 * flags. An invalid preset or -crf makes FFmpeg exit immediately, and the
 * video route then restarts the whole stream on CPU.
 */

import { SDR_BT709_OUTPUT_ARGS, toneMapFilter, type HdrToneMap } from "./hdr-tone-map";

export type LiveEncodeMode = "hardware" | "cpu-decode" | "software";

export type FfmpegLiveSettings = {
  enableTranscoding?: boolean | null;
  videoCodec?: string | null;
  videoBitrate?: string | null;
  videoBufSize?: string | null;
  videoPreset?: string | null;
  videoCrf?: number | null;
  targetResolution?: string | null;
  audioCodec?: string | null;
  audioBitrate?: string | null;
  audioChannels?: number | null;
  audioSampleRate?: number | null;
  threads?: number | null;
  maxMuxingQueueSize?: number | null;
  enableHardwareAccel?: boolean | null;
  hardwareAccelType?: string | null;
  hardwareDevice?: string | null;
  logLevel?: string | null;
  globalOptions?: string | null;
  inputOptions?: string | null;
  outputOptions?: string | null;
  outputFormat?: string | null;
};

export type LiveFfmpegEnv = {
  hwaccelMethod?: string | null;
  hardwareDevice?: string | null;
  /**
   * FFmpeg >= 6.1 understands `-readrate_initial_burst`. Older builds (Debian
   * bookworm ships 5.1) exit on the unknown flag, so callers pass the probed
   * value. Undefined keeps the burst.
   */
  readrateInitialBurst?: boolean;
  /**
   * Opt-in (NVENC_GPU_FRAMES=true): keep decoded frames in GPU memory and
   * scale with scale_cuda, so NVDEC -> scale -> NVENC never copies frames
   * through system RAM. Off by default; a failing filter graph steps down to
   * cpu-decode through the normal encoder ladder.
   */
  gpuFrames?: boolean;
};

/** Pace live input at 1x so one encoder never races ahead of its viewers. */
function pushLiveReadrate(args: string[], initialBurst: boolean): void {
  args.push("-readrate", "1");
  if (initialBurst) {
    args.push("-readrate_initial_burst", "2");
  }
}

const NVENC_PRESETS = new Set([
  "default",
  "slow",
  "medium",
  "fast",
  "hp",
  "hq",
  "bd",
  "ll",
  "llhq",
  "llhp",
  "lossless",
  "losslesshp",
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "p7",
]);

export function encoderFamily(
  codec: string,
): "nvenc" | "qsv" | "vaapi" | "videotoolbox" | "software" {
  if (codec.endsWith("_nvenc")) return "nvenc";
  if (codec.endsWith("_qsv")) return "qsv";
  if (codec.endsWith("_vaapi")) return "vaapi";
  if (codec.endsWith("_videotoolbox")) return "videotoolbox";
  return "software";
}

export function initialEncodeMode(codec: string | null | undefined): LiveEncodeMode {
  if (!codec || encoderFamily(codec) === "software") {
    return "software";
  }
  return "hardware";
}

export function nextLiveEncodeMode(mode: LiveEncodeMode): LiveEncodeMode | null {
  if (mode === "hardware") return "cpu-decode";
  if (mode === "cpu-decode") return "software";
  return null;
}

/** Map x264 preset names onto NVENC p1–p7. Native NVENC names pass through. */
export function nvencPreset(preset: string | null | undefined): string {
  const value = (preset || "p4").trim().toLowerCase();
  if (NVENC_PRESETS.has(value) && !["medium", "fast", "slow", "default"].includes(value)) {
    return value;
  }
  switch (value) {
    case "ultrafast":
    case "superfast":
    case "veryfast":
    case "faster":
      return "p1";
    case "fast":
      return "p2";
    case "slow":
    case "slower":
      return "p6";
    case "veryslow":
      return "p7";
    case "medium":
    case "default":
    default:
      return "p4";
  }
}

function pushWords(args: string[], raw: string | null | undefined): void {
  if (!raw) return;
  for (const word of raw.split(/\s+/)) {
    if (word) args.push(word);
  }
}

function hasFlag(raw: string | null | undefined, flag: string): boolean {
  if (!raw) return false;
  return raw.split(/\s+/).includes(flag);
}

/** Browser MSE plays H.264 steadily. HEVC through mpegts.js stutters. */
function browserSafeVideoCodec(codec: string): string {
  if (codec.startsWith("hevc_")) {
    return `h264_${codec.slice("hevc_".length)}`;
  }
  if (codec === "libx265") {
    return "libx264";
  }
  return codec;
}

/**
 * Seek-to-now remux. Copy video, transcode audio to AAC so MPEG-TS stays
 * valid (TrueHD/DTS/PGS in an MKV will fail `-c copy`). The mpegts muxer
 * inserts h264/hevc Annex-B itself. Do not add dump_extra — it fails on
 * many Plex MKVs and the client then waits out a dead stream before
 * falling back to a full transcode.
 *
 * Keep the probe as short as the transcode path. A 5s/5MB probe plus
 * FFmpeg's default 10s interleave hold (video copy waiting on AAC) sends
 * no TS, and ExoPlayer reports an unrecognized container after ~17s.
 *
 * Pace the read at 1x after a short burst. Copy has no encoder to slow it
 * down, so an unpaced remux pulls the whole MKV into Node and RAM climbs
 * into multiple gigabytes while the player only consumes realtime.
 */
export function buildCopyFfmpegArgs(
  streamUrl: string,
  seekSeconds: number,
  options?: {
    discontinuity?: boolean;
    logLevel?: string | null;
    /** Local files whose audio is already stereo AAC: copy it too (no encode at all). */
    copyAudio?: boolean;
    readrateInitialBurst?: boolean;
  },
): string[] {
  const pacing: string[] = [];
  pushLiveReadrate(pacing, options?.readrateInitialBurst !== false);
  const args = [
    "-loglevel",
    options?.logLevel || "error",
    "-nostdin",
    "-ss",
    `${seekSeconds}`,
    ...pacing,
    "-probesize",
    "131072",
    "-analyzeduration",
    "200000",
    "-fflags",
    "+genpts+discardcorrupt+nobuffer+fastseek",
    "-flags",
    "low_delay",
    "-i",
    streamUrl,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-c:v",
    "copy",
    ...(options?.copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-ac", "2", "-b:a", "160k"]),
    "-max_interleave_delta",
    "0",
    "-f",
    "mpegts",
    "-mpegts_flags",
    options?.discontinuity
      ? "+resend_headers+initial_discontinuity"
      : "+resend_headers",
    "-flush_packets",
    "1",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-",
  ];
  return args;
}

export function buildLiveFfmpegArgs(
  streamUrl: string,
  seekSeconds: number,
  settings: FfmpegLiveSettings | null,
  options: {
    mode: LiveEncodeMode;
    discontinuity?: boolean;
    /** CPU fallback after a hardware encoder failed. Uses a cheap x264 preset. */
    fallback?: boolean;
    /** MWS opt-in remux even when transcoding is enabled. */
    copy?: boolean;
    /** In-browser playback. H.264, paced, no low-latency encoder tune. */
    browser?: boolean;
    /**
     * Read at 1x after a short burst. Used for local files: a disk read has no
     * network to slow it, so an unpaced encode runs flat out and burns CPU
     * for video nobody is watching yet.
     */
    pace?: boolean;
    /**
     * HDR source to tone-map to SDR bt709 (CPU zscale + tonemap). Only the
     * software and NVENC encoders apply it; the caller passes it only when
     * the filters were found.
     */
    toneMap?: HdrToneMap | null;
  },
  env: LiveFfmpegEnv = {},
): string[] {
  const useEnvironmentFallback = !settings;
  const enableTranscoding = settings?.enableTranscoding ?? true;

  if (
    !options.browser &&
    (options.copy === true || (!enableTranscoding && !useEnvironmentFallback && !options.fallback))
  ) {
    return buildCopyFfmpegArgs(streamUrl, seekSeconds, {
      discontinuity: options.discontinuity,
      logLevel: settings?.logLevel,
      readrateInitialBurst: env.readrateInitialBurst,
    });
  }

  let videoCodec = settings?.videoCodec || "libx264";
  if (options.browser) {
    videoCodec = browserSafeVideoCodec(videoCodec);
  }
  if (useEnvironmentFallback) {
    switch (env.hwaccelMethod) {
      case "nvenc":
        videoCodec = "h264_nvenc";
        break;
      case "qsv":
        videoCodec = "h264_qsv";
        break;
      case "vaapi":
        videoCodec = "h264_vaapi";
        break;
      case "videotoolbox":
        videoCodec = "h264_videotoolbox";
        break;
      default:
        videoCodec = "libx264";
    }
  }
  let family = encoderFamily(videoCodec);
  if (options.mode === "software" && family !== "software") {
    videoCodec = "libx264";
    family = "software";
  }

  const args: string[] = [];
  pushWords(args, settings?.globalOptions);
  args.push("-loglevel", settings?.logLevel || "error");
  args.push("-nostdin");

  const hwMethod = useEnvironmentFallback ? env.hwaccelMethod : settings?.hardwareAccelType;
  const checkboxOn =
    settings?.enableHardwareAccel === true &&
    !!hwMethod &&
    hwMethod !== "none" &&
    hwMethod !== "cpu";
  const codecImpliesGpu = family !== "software";
  const useHwDecode = options.mode === "hardware" && (checkboxOn || codecImpliesGpu || (useEnvironmentFallback && !!hwMethod && hwMethod !== "none" && hwMethod !== "cpu"));

  // Tone mapping runs on the CPU, so frames must come back to system memory.
  const browserCuda = !!options.browser && useHwDecode;
  const toneMap =
    options.toneMap && (family === "software" || family === "nvenc") && !browserCuda ? options.toneMap : null;
  const gpuFrames =
    !toneMap &&
    env.gpuFrames === true &&
    useHwDecode &&
    family === "nvenc" &&
    (codecImpliesGpu || hwMethod === "nvenc" || hwMethod === "cuda");
  if (useHwDecode) {
    const accel = codecImpliesGpu ? family : hwMethod;
    if (accel === "nvenc" || accel === "cuda") {
      args.push("-hwaccel", "cuda");
      if (gpuFrames) {
        args.push("-hwaccel_output_format", "cuda");
      }
    } else if (accel === "qsv") {
      args.push("-hwaccel", "qsv");
    } else if (accel === "vaapi") {
      args.push("-hwaccel", "vaapi");
      const device = settings?.hardwareDevice || env.hardwareDevice;
      if (device) args.push("-vaapi_device", device);
    } else if (accel === "videotoolbox") {
      args.push("-hwaccel", "videotoolbox");
    }
  }

  // Short analyze so the first TS packets leave quickly. 128KB is enough
  // for typical Plex MP4/MKV headers without a multi-megabyte probe.
  args.push("-ss", `${seekSeconds}`);
  // Live TV is shared by every viewer of the channel. Without pacing the
  // encoder (NVENC especially) runs several times faster than realtime, the
  // fastest client sets the pace and everyone else's buffer fills until they
  // are dropped and reconnect. Browser playback of a remote stream keeps its
  // own pacing; a local file read from disk has nothing to slow it, so it is
  // paced in the browser too.
  if (!options.browser || options.pace) {
    pushLiveReadrate(args, env.readrateInitialBurst !== false);
  }
  args.push("-probesize", "131072");
  args.push("-analyzeduration", "200000");
  args.push(
    "-fflags",
    options.browser
      ? "+genpts+discardcorrupt+fastseek"
      : "+genpts+discardcorrupt+nobuffer+fastseek",
  );
  if (!options.browser) {
    args.push("-flags", "low_delay");
  }
  pushWords(args, settings?.inputOptions);
  args.push("-i", streamUrl);
  // First video + first audio only. Without this FFmpeg also tries to carry
  // a movie's PGS subtitles / attachments into MPEG-TS, and picks streams by
  // its own rules instead of the main ones. Users' own output options may map.
  if (!hasFlag(settings?.outputOptions, "-map")) {
    args.push("-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn");
  }

  args.push("-c:v", videoCodec);

  const bitrate = settings?.videoBitrate || (useEnvironmentFallback ? "3000k" : null);
  const bufsize = settings?.videoBufSize || (useEnvironmentFallback ? "6000k" : null);
  if (bitrate) args.push("-b:v", bitrate);
  if (bitrate && family === "nvenc") args.push("-maxrate", bitrate);
  if (bufsize) args.push("-bufsize", bufsize);

  if (family === "nvenc") {
    args.push("-preset", options.browser ? "p4" : nvencPreset(settings?.videoPreset));
    if (!options.browser && !hasFlag(settings?.outputOptions, "-tune")) {
      args.push("-tune", "ll");
    }
    args.push("-rc", "cbr");
    args.push("-bf", "0");
    args.push("-g", options.browser ? "48" : "60");
    if (options.browser) {
      args.push("-profile:v", "high");
    }
  } else if (family === "software") {
    const preset = options.fallback
      ? "veryfast"
      : settings?.videoPreset || (useEnvironmentFallback ? "veryfast" : "veryfast");
    args.push("-preset", preset);
    if (!options.browser && (options.fallback || !settings?.videoPreset)) {
      args.push("-tune", "zerolatency");
    }
    const configuredThreads = settings?.threads ?? 0;
    const threads = options.fallback
      ? (configuredThreads > 0 ? Math.min(configuredThreads, 2) : 2)
      : (configuredThreads > 0 ? configuredThreads : 2);
    args.push("-threads", `${threads}`);
    // x264's default is a keyframe every 250 frames (~10 s): a viewer joining
    // a shared channel hears sound but waits that long for a picture.
    if (!hasFlag(settings?.outputOptions, "-g")) {
      args.push("-g", options.browser ? "48" : "60");
    }
    if (settings?.videoCrf != null && !useEnvironmentFallback && !options.fallback) {
      args.push("-crf", `${settings.videoCrf}`);
    }
  } else if (settings?.videoPreset) {
    args.push("-preset", settings.videoPreset);
    if (settings.videoCrf != null) {
      args.push("-crf", `${settings.videoCrf}`);
    }
  }

  // Do not add a CPU scale filter on the browser path when CUDA decode is
  // active — that filter graph exits FFmpeg and the client only sees null TS.
  const resolution = settings?.targetResolution;
  const scaleTo = !options.browser && resolution && resolution !== "original" ? resolution : null;
  if (gpuFrames) {
    // nv12 also turns 10-bit HEVC (p010) into something h264_nvenc accepts.
    const size = scaleTo ? `${scaleTo.replace("x", ":")}:` : "";
    args.push("-vf", `scale_cuda=${size}format=nv12`);
  } else {
    // 10-bit / HDR sources: NVENC H.264 can't take 10-bit frames (FFmpeg exits)
    // and libx264 would make High 10 that TVs and browsers can't decode.
    // Frames here are in system memory, so convert to 8-bit 4:2:0. 8-bit input
    // already matches one of the two and passes through unchanged.
    const filters: string[] = [];
    if (toneMap) {
      // HDR: tone-map to SDR bt709 (scales too) and ends in 8-bit yuv420p.
      filters.push(toneMapFilter(toneMap, scaleTo));
    } else {
      if (scaleTo) filters.push(`scale=${scaleTo}`);
      // (Browser + CUDA decode stays filter-free, see above; a 10-bit failure
      // there falls back to CPU decode, which gets this filter.)
      if ((family === "software" || family === "nvenc") && !browserCuda) filters.push("format=yuv420p|nv12");
    }
    if (filters.length) args.push("-vf", filters.join(","));
  }
  if (toneMap) args.push(...SDR_BT709_OUTPUT_ARGS);

  args.push("-c:a", options.browser ? "aac" : settings?.audioCodec || "aac");
  if (options.browser) {
    args.push("-profile:a", "aac_low");
  }
  if (settings?.audioBitrate) args.push("-b:a", settings.audioBitrate);
  else if (useEnvironmentFallback) args.push("-b:a", "128k");
  if (settings?.audioChannels) args.push("-ac", `${settings.audioChannels}`);
  else if (useEnvironmentFallback) args.push("-ac", "2");
  if (settings?.audioSampleRate) args.push("-ar", `${settings.audioSampleRate}`);

  if (family !== "software" && settings?.threads && settings.threads > 0) {
    args.push("-threads", `${settings.threads}`);
  }
  if (settings?.maxMuxingQueueSize) {
    args.push("-max_muxing_queue_size", `${settings.maxMuxingQueueSize}`);
  }

  pushWords(args, settings?.outputOptions);
  args.push("-f", settings?.outputFormat || "mpegts");
  args.push("-flush_packets", "1");
  args.push("-muxdelay", "0");
  args.push("-muxpreload", "0");
  if (options.discontinuity) {
    args.push("-mpegts_flags", "+resend_headers+initial_discontinuity");
  }
  args.push("-");
  return args;
}
