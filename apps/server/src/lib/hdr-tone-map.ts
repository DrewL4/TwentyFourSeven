import type { RemoteVideoInfo } from "./local-media/playback";

/**
 * HDR -> SDR for transcodes. A 10-bit PQ/HLG (bt2020) file squeezed to 8-bit
 * without a tone map looks grey and washed out, and keeping its smpte2084 /
 * bt2020 tags on 8-bit output makes TVs show it even worse. The chain below
 * runs on the CPU (zscale + tonemap, FFmpeg 5.1 has both) for libx264 and for
 * NVENC: with `-hwaccel cuda` and no `-hwaccel_output_format` the decoded
 * frames are already in system memory, so NVENC just encodes the result.
 */

export type ToneMapTransfer = "smpte2084" | "arib-std-b67";
export type HdrToneMap = { transfer: ToneMapTransfer };

/** The source's HDR transfer, normalized to FFmpeg/zscale names; null for SDR. */
export function hdrTransfer(info: RemoteVideoInfo | null | undefined): ToneMapTransfer | null {
  const trc = String(info?.colorTrc ?? "").toLowerCase();
  if (!trc) return null;
  if (/smpte ?2084|^pq$|st2084/.test(trc)) return "smpte2084";
  if (/arib-std-b67|^hlg$/.test(trc)) return "arib-std-b67";
  return null;
}

export type HdrToneMapPlan = {
  toneMap: HdrToneMap | null;
  /** One line for the stream log, if anything about HDR applies. */
  log?: { level: "info" | "warn"; message: string };
};

/**
 * Decide the tone map for a transcode. `canToneMap` is the background filter
 * probe's answer (false until it finishes, or if zscale/tonemap is missing).
 */
export function planHdrToneMap(info: RemoteVideoInfo | null | undefined, canToneMap: boolean): HdrToneMapPlan {
  const transfer = hdrTransfer(info);
  if (info?.dolbyVisionProfile === 5) {
    // Profile 5 has no HDR10 base layer (IPTPQc2): only libplacebo maps it right.
    return {
      toneMap: null,
      log: {
        level: "warn",
        message: "Dolby Vision profile 5: no HDR10 base layer, colors will be wrong (green/purple) without libplacebo; transcoding without tone mapping",
      },
    };
  }
  if (!transfer) return { toneMap: null };
  if (!canToneMap) {
    return {
      toneMap: null,
      log: { level: "warn", message: `HDR ${transfer} but FFmpeg tone mapping is unavailable: plain 8-bit conversion (washed out)` },
    };
  }
  return {
    toneMap: { transfer },
    log: { level: "info", message: `HDR ${transfer} -> SDR bt709 tone map (zscale+tonemap hable)` },
  };
}

/**
 * CPU filter chain: linearize, convert primaries to bt709, hable tone map,
 * back to bt709 transfer/matrix, limited range 8-bit 4:2:0. Scaling happens in
 * the first zscale so the float stages run at the output size.
 */
export function toneMapFilter(toneMap: HdrToneMap, scaleTo?: string | null): string {
  const size = scaleTo && /^\d+x\d+$/.test(scaleTo) ? `w=${scaleTo.split("x")[0]}:h=${scaleTo.split("x")[1]}:` : "";
  return [
    `zscale=${size}tin=${toneMap.transfer}:min=bt2020nc:pin=bt2020:t=linear:npl=100`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ].join(",");
}

/** Output tags so players treat the result as SDR bt709. */
export const SDR_BT709_OUTPUT_ARGS = [
  "-color_primaries", "bt709",
  "-color_trc", "bt709",
  "-colorspace", "bt709",
  "-color_range", "tv",
];
