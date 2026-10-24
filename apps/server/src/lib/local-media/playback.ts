/** Decide, per file, whether the stream can be passed through without re-encoding. */

export type LocalProbe = {
  videoCodec?: string | null;
  audioCodec?: string | null;
  audioChannels?: number | null;
  pixFmt?: string | null;
};

export type LocalPlaybackPlan = {
  /** Copy the video as-is (no encoder, very low CPU). */
  copyVideo: boolean;
  /** Also copy the audio (already AAC stereo). */
  copyAudio: boolean;
  reason: string;
};

const IPTV_COPY_VIDEO = new Set(["h264", "hevc", "mpeg2video"]);

function is8bit(pixFmt?: string | null): boolean {
  if (!pixFmt) return true;
  return !/(10|12)(le|be)?$|p010|p016/i.test(pixFmt);
}

export function chooseLocalPlayback(probe: LocalProbe | null | undefined, opts: { browser: boolean }): LocalPlaybackPlan {
  const v = (probe?.videoCodec || "").toLowerCase();
  const a = (probe?.audioCodec || "").toLowerCase();
  if (!v) return { copyVideo: false, copyAudio: false, reason: "not probed" };
  const videoOk = opts.browser ? v === "h264" && is8bit(probe?.pixFmt) : IPTV_COPY_VIDEO.has(v);
  if (!videoOk) {
    return { copyVideo: false, copyAudio: false, reason: `video ${v}${probe?.pixFmt ? ` ${probe.pixFmt}` : ""} needs converting` };
  }
  const copyAudio = a === "aac" && (probe?.audioChannels ?? 2) <= 2;
  return { copyVideo: true, copyAudio, reason: copyAudio ? "copy video+audio" : `copy video, convert ${a || "no"} audio` };
}

/**
 * What Plex says about a movie or episode's video, read from the same
 * /library/metadata answer that gives the file part. Any field may be missing.
 */
export type RemoteVideoInfo = {
  videoCodec?: string | null;
  videoProfile?: string | null;
  bitDepth?: number | null;
  colorTrc?: string | null;
  dolbyVision?: boolean | null;
  height?: number | null;
  bitrateKbps?: number | null;
  audioCodec?: string | null;
  audioChannels?: number | null;
};

/** A copied stream above this goes to the player untouched: over Wi-Fi or a phone link it stalls. */
export const COPY_MAX_BITRATE_KBPS = 25_000;

const COPY_SAFE_VIDEO = new Set(["h264", "hevc", "mpeg2video"]);
const HDR_TRANSFERS = /smpte2084|arib-std-b67|pq|hlg/i;

function isHighBitDepth(info: RemoteVideoInfo): boolean {
  if ((info.bitDepth ?? 0) > 8) return true;
  return /\b(main ?1[02]|high ?10|high ?4:[24]:[24])/i.test(info.videoProfile || "");
}

/**
 * Why a player's copy=1 request should be transcoded instead, or null to
 * copy as asked. Copy hands the file's video to the player as-is: a 4K
 * remux's 10-bit / HDR / Dolby Vision HEVC at 40-80 Mbps starts slowly,
 * stalls after a moment and leaves many TV players with sound and no
 * picture. Unknown media keeps the old behaviour (copy).
 */
export function copyRemuxBlocker(
  info: RemoteVideoInfo | null | undefined,
  maxBitrateKbps: number = COPY_MAX_BITRATE_KBPS,
): string | null {
  if (!info) return null;
  const codec = (info.videoCodec || "").toLowerCase();
  if (codec && !COPY_SAFE_VIDEO.has(codec)) return `video ${codec} can't be copied into live TV`;
  if (info.dolbyVision) return "Dolby Vision video";
  if (isHighBitDepth(info)) return "10-bit video";
  if (HDR_TRANSFERS.test(info.colorTrc || "")) return "HDR video";
  const kbps = info.bitrateKbps ?? 0;
  if (maxBitrateKbps > 0 && kbps > maxBitrateKbps) {
    return `${Math.round(kbps / 1000)} Mbps is too high to pass through`;
  }
  return null;
}

/** Short summary for logs, e.g. "hevc main 10 10-bit smpte2084 DV 2160p 62Mbps truehd 8ch". */
export function describeRemoteVideo(info: RemoteVideoInfo | null | undefined): string {
  if (!info) return "unknown";
  const parts = [
    info.videoCodec,
    info.videoProfile,
    info.bitDepth ? `${info.bitDepth}-bit` : null,
    info.colorTrc,
    info.dolbyVision ? "DV" : null,
    info.height ? `${info.height}p` : null,
    info.bitrateKbps ? `${Math.round(info.bitrateKbps / 1000)}Mbps` : null,
    info.audioCodec,
    info.audioChannels ? `${info.audioChannels}ch` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ").toLowerCase() : "unknown";
}
