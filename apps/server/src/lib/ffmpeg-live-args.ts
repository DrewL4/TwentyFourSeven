/**
 * Live MPEG-TS FFmpeg arguments.
 *
 * Hardware codecs (hevc_nvenc, h264_qsv, …) must not be given libx264-only
 * flags. An invalid preset or -crf makes FFmpeg exit immediately, and the
 * video route then restarts the whole stream on CPU.
 */

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
};

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

/**
 * Seek-to-now remux. MPEG-TS gets Annex-B video automatically; AAC is
 * rewritten as ADTS by the muxer (do not use aac_adtstoasc — that is MP4).
 */
export function buildCopyFfmpegArgs(
  streamUrl: string,
  seekSeconds: number,
  options?: {
    discontinuity?: boolean;
    logLevel?: string | null;
  },
): string[] {
  const args = [
    "-loglevel",
    options?.logLevel || "error",
    "-nostdin",
    "-ss",
    `${seekSeconds}`,
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
    "-c",
    "copy",
    "-f",
    "mpegts",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
  ];
  if (options?.discontinuity) {
    args.push("-mpegts_flags", "+resend_headers+initial_discontinuity");
  }
  args.push("-");
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
  },
  env: LiveFfmpegEnv = {},
): string[] {
  const useEnvironmentFallback = !settings;
  const enableTranscoding = settings?.enableTranscoding ?? true;

  if (options.copy === true || (!enableTranscoding && !useEnvironmentFallback && !options.fallback)) {
    return buildCopyFfmpegArgs(streamUrl, seekSeconds, {
      discontinuity: options.discontinuity,
      logLevel: settings?.logLevel,
    });
  }

  let videoCodec = settings?.videoCodec || "libx264";
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

  if (useHwDecode) {
    const accel = codecImpliesGpu ? family : hwMethod;
    if (accel === "nvenc" || accel === "cuda") {
      args.push("-hwaccel", "cuda");
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
  args.push("-probesize", "131072");
  args.push("-analyzeduration", "200000");
  args.push("-fflags", "+genpts+discardcorrupt+nobuffer+fastseek");
  args.push("-flags", "low_delay");
  pushWords(args, settings?.inputOptions);
  args.push("-i", streamUrl);

  args.push("-c:v", videoCodec);

  const bitrate = settings?.videoBitrate || (useEnvironmentFallback ? "3000k" : null);
  const bufsize = settings?.videoBufSize || (useEnvironmentFallback ? "6000k" : null);
  if (bitrate) args.push("-b:v", bitrate);
  if (bitrate && family === "nvenc") args.push("-maxrate", bitrate);
  if (bufsize) args.push("-bufsize", bufsize);

  if (family === "nvenc") {
    args.push("-preset", nvencPreset(settings?.videoPreset));
    if (!hasFlag(settings?.outputOptions, "-tune")) {
      args.push("-tune", "ll");
    }
    args.push("-rc", "cbr");
    args.push("-bf", "0");
    args.push("-g", "60");
  } else if (family === "software") {
    const preset = options.fallback
      ? "veryfast"
      : settings?.videoPreset || (useEnvironmentFallback ? "veryfast" : "veryfast");
    args.push("-preset", preset);
    if (options.fallback || !settings?.videoPreset) {
      args.push("-tune", "zerolatency");
    }
    const configuredThreads = settings?.threads ?? 0;
    const threads = options.fallback
      ? (configuredThreads > 0 ? Math.min(configuredThreads, 2) : 2)
      : (configuredThreads > 0 ? configuredThreads : 2);
    args.push("-threads", `${threads}`);
    if (settings?.videoCrf != null && !useEnvironmentFallback && !options.fallback) {
      args.push("-crf", `${settings.videoCrf}`);
    }
  } else if (settings?.videoPreset) {
    args.push("-preset", settings.videoPreset);
    if (settings.videoCrf != null) {
      args.push("-crf", `${settings.videoCrf}`);
    }
  }

  const resolution = settings?.targetResolution;
  if (resolution && resolution !== "original") {
    args.push("-vf", `scale=${resolution}`);
  }

  args.push("-c:a", settings?.audioCodec || "aac");
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
