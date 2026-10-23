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
