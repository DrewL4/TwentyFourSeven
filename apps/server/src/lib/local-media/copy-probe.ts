import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import type { LocalProbe, RemoteVideoInfo } from "./playback";

/**
 * What a local file's video is, for the copy=1 safety check (the same facts
 * Plex gives us for its files). The library scan already stores codec and
 * pixel format; HDR transfer, Dolby Vision and bitrate need one more
 * ffprobe, run once per file (keyed by path + size + mtime) and kept in memory.
 */

type FfprobeJson = {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    pix_fmt?: string;
    bits_per_raw_sample?: string;
    color_transfer?: string;
    height?: number;
    bit_rate?: string;
    channels?: number;
    side_data_list?: Array<{ side_data_type?: string }>;
  }>;
  format?: { bit_rate?: string };
};

function bitDepthFromPixFmt(pixFmt?: string | null): number | null {
  if (!pixFmt) return null;
  const p = /^p0(10|16)/i.exec(pixFmt);
  if (p) return Number(p[1]);
  const m = /(9|10|12|14|16)(le|be)$/i.exec(pixFmt);
  return m ? Number(m[1]) : 8;
}

/** The scan's stored probe, as video info (codec + bit depth only). */
export function videoInfoFromLocalProbe(probe: LocalProbe | null | undefined): RemoteVideoInfo | undefined {
  if (!probe?.videoCodec) return undefined;
  return {
    videoCodec: probe.videoCodec.toLowerCase(),
    bitDepth: bitDepthFromPixFmt(probe.pixFmt),
    audioCodec: probe.audioCodec ?? null,
    audioChannels: probe.audioChannels ?? null,
  };
}

/** ffprobe JSON → video info. */
export function videoInfoFromFfprobe(data: FfprobeJson): RemoteVideoInfo | undefined {
  const v = data.streams?.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  if (!v?.codec_name) return undefined;
  const a = data.streams?.find((s) => s.codec_type === "audio");
  const raw = Number(v.bits_per_raw_sample);
  const streamKbps = Number(v.bit_rate) / 1000;
  const formatKbps = Number(data.format?.bit_rate) / 1000;
  const kbps = Number.isFinite(streamKbps) && streamKbps > 0 ? streamKbps : Number.isFinite(formatKbps) && formatKbps > 0 ? formatKbps : null;
  return {
    videoCodec: v.codec_name.toLowerCase(),
    videoProfile: v.profile ?? null,
    bitDepth: Number.isFinite(raw) && raw > 0 ? raw : bitDepthFromPixFmt(v.pix_fmt),
    colorTrc: v.color_transfer ?? null,
    dolbyVision: !!v.side_data_list?.some((s) => /dovi|dolby vision/i.test(s.side_data_type || "")) || /dolby ?vision|dvh/i.test(v.profile || ""),
    height: v.height ?? null,
    bitrateKbps: kbps === null ? null : Math.round(kbps),
    audioCodec: a?.codec_name ?? null,
    audioChannels: a?.channels ?? null,
  };
}

export function ffprobeVideo(file: string): Promise<FfprobeJson> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries",
        "stream=codec_type,codec_name,profile,pix_fmt,bits_per_raw_sample,color_transfer,height,bit_rate,channels:stream_side_data=side_data_type:format=bit_rate",
        "-of", "json",
        file,
      ],
      { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout) as FfprobeJson);
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

type Deps = {
  probe: (file: string) => Promise<FfprobeJson>;
  stat: (file: string) => Promise<{ size: number; mtimeMs: number }>;
  max: number;
};

export function createLocalCopyProbe(deps: Deps) {
  const cache = new Map<string, Promise<RemoteVideoInfo | undefined>>();
  let probes = 0;

  /** Video info for copy=1 on this file; falls back to the scan's probe when ffprobe fails. */
  async function videoInfo(file: string, stored?: LocalProbe | null): Promise<RemoteVideoInfo | undefined> {
    const fallback = videoInfoFromLocalProbe(stored);
    let key: string;
    try {
      const st = await deps.stat(file);
      key = `${file}\u0000${st.size}\u0000${Math.round(st.mtimeMs)}`;
    } catch {
      return fallback;
    }
    let hit = cache.get(key);
    if (!hit) {
      probes++;
      hit = deps.probe(file).then(
        (json) => videoInfoFromFfprobe(json),
        () => undefined,
      );
      cache.set(key, hit);
      if (cache.size > deps.max) cache.delete(cache.keys().next().value as string);
    }
    const info = await hit;
    if (!info) cache.delete(key); // don't remember a failed probe
    return info ?? fallback;
  }

  return { videoInfo, probeCount: () => probes };
}

export const localCopyProbe = createLocalCopyProbe({
  probe: ffprobeVideo,
  stat: (file) => fs.stat(file),
  max: 1000,
});
