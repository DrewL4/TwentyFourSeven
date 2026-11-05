/**
 * Direct play first. One decision per program: pass the video through
 * untouched (`copy`: remux into MPEG-TS, no re-encode, no GPU), or transcode
 * it (`transcode`: GPU encode, H.264 8-bit SDR) because this client can't
 * play it as it is.
 *
 * Every transcode comes with a reason, which goes into the stream log.
 */

import type { ClientCaps } from "./client-caps";
import { TS_COPY_CODECS } from "./client-caps";
import { hdrTransfer } from "./hdr-tone-map";
import { HDR_TRANSFERS, isHighBitDepth, type RemoteVideoInfo } from "./local-media/playback";

export type PlaybackDecision = {
  action: "copy" | "transcode";
  /** Why (always set: the log line for this program). */
  reason: string;
  /** Copy only: drop Dolby Vision RPU / enhancement-layer NAL units. */
  stripDolbyVision: boolean;
  /** Copy only: the audio is AAC stereo and can pass through as well. */
  copyAudio: boolean;
};

export type DecisionOptions = {
  /** Server setting: false means TFS can't transcode at all, so it always passes through. */
  transcodingEnabled?: boolean;
};

const COPY_SET = new Set<string>(TS_COPY_CODECS);

function copy(reason: string, info: RemoteVideoInfo | null | undefined, strip = false): PlaybackDecision {
  const aac = (info?.audioCodec || "").toLowerCase() === "aac";
  const ch = info?.audioChannels ?? 2;
  return { action: "copy", reason, stripDolbyVision: strip, copyAudio: aac && ch > 0 && ch <= 2 };
}

export function transcodeDecision(reason: string): PlaybackDecision {
  return { action: "transcode", reason, stripDolbyVision: false, copyAudio: false };
}

export function isHdrSource(info: RemoteVideoInfo | null | undefined): boolean {
  if (!info) return false;
  return !!hdrTransfer(info) || HDR_TRANSFERS.test(info.colorTrc || "");
}

/** The program's video against what this client can decode. */
export function decidePlayback(
  caps: ClientCaps,
  info: RemoteVideoInfo | null | undefined,
  options: DecisionOptions = {},
): PlaybackDecision {
  const canTranscode = options.transcodingEnabled !== false;

  if (caps.forceTranscode && canTranscode) {
    return transcodeDecision("client asked for a transcode (copy=0)");
  }
  if (!canTranscode) {
    return copy("transcoding is disabled in settings", info, !!info?.dolbyVision);
  }

  const codec = (info?.videoCodec || "").toLowerCase();
  if (!codec) {
    return caps.trustUnknownSource
      ? copy(`source format unknown, trusting ${caps.id} client`, info)
      : transcodeDecision(`source format unknown and ${caps.id} client can't declare what it plays`);
  }
  if (!COPY_SET.has(codec)) return transcodeDecision(`${codec} can't be carried in live TV as-is`);
  if (!caps.codecs.has(codec)) return transcodeDecision(`${caps.id} client doesn't decode ${codec}`);

  const dv = !!info?.dolbyVision;
  const dvProfile = info?.dolbyVisionProfile ?? null;
  const hdr = isHdrSource(info);
  const tenBit = !!info && isHighBitDepth(info);

  if (dv && dvProfile === 5) {
    // Profile 5 has no HDR10 base layer: only a client that decodes DV shows it right.
    if (!caps.dv) return transcodeDecision(`Dolby Vision profile 5 and ${caps.id} client can't decode Dolby Vision`);
  } else if (dv && !caps.dv) {
    // Profiles 7/8 carry an HDR10/HLG base layer. Strip the DV layers and play that.
    if (!caps.hdr) return transcodeDecision(`Dolby Vision/HDR source and ${caps.id} client has no HDR display`);
  } else if (hdr && !caps.hdr) {
    return transcodeDecision(`HDR source and ${caps.id} client has no HDR display`);
  }

  if (tenBit) {
    const ok = codec === "hevc" ? caps.hevc10 : codec === "h264" ? caps.h264High10 : false;
    if (!ok) return transcodeDecision(`10-bit ${codec} and ${caps.id} client can't decode it`);
  }

  const height = info?.height ?? 0;
  if (caps.maxHeight > 0 && height > caps.maxHeight) {
    return transcodeDecision(`${height}p is taller than ${caps.id} client's ${caps.maxHeight}p`);
  }
  const kbps = info?.bitrateKbps ?? 0;
  if (caps.maxKbps > 0 && kbps > caps.maxKbps) {
    return transcodeDecision(`${Math.round(kbps / 1000)} Mbps is above ${caps.id} client's ${Math.round(caps.maxKbps / 1000)} Mbps`);
  }

  // Without a DV decoder the RPU / enhancement-layer NAL units are noise (or worse) in MPEG-TS.
  const strip = dv && !caps.dv && codec === "hevc";
  const what = [codec, tenBit ? "10-bit" : null, hdr ? "HDR" : null, dv ? "DV" : null].filter(Boolean).join(" ");
  return copy(`${what || codec} plays as-is on ${caps.id} client`, info, strip);
}

/**
 * Every transcode slot is busy and this client would normally get a
 * transcode: pass the video through anyway (a picture it may struggle with
 * beats a refused stream). Codecs MPEG-TS can't carry still transcode.
 */
export function passThroughAnyway(info: RemoteVideoInfo | null | undefined, why: string): PlaybackDecision {
  const codec = (info?.videoCodec || "").toLowerCase();
  if (codec && !COPY_SET.has(codec)) return transcodeDecision(`${codec} can't be carried in live TV as-is`);
  return copy(why, info, !!info?.dolbyVision && codec === "hevc");
}
