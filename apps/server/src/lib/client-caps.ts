/**
 * What the device on the other end of /api/video can play as-is.
 *
 * Direct play first: TFS passes a program's video through untouched (a remux
 * into MPEG-TS, no re-encode) whenever the client can decode it, and
 * transcodes (on the GPU) only when it can't. To decide that, TFS needs to know
 * the client. In order of trust:
 *
 *  1. `browser=1`: the web player (H.264, 8-bit, SDR only).
 *  2. A declaration: `caps=hevc,hevc10,hdr,maxh=2160,maxkbps=40000` on the URL,
 *     or the same words in an `X-TFS-Caps` header. The client lists what it
 *     can decode; anything it leaves out is treated as unsupported.
 *  3. A User-Agent TFS knows (our own MWS-TV app, the common IPTV players).
 *  4. `copy=1` from an app TFS doesn't know: the old "I can take the file as-is"
 *     request. Kept exactly as it was (8-bit, SDR, 25 Mbps ceiling).
 *  5. Anything else: a generic IPTV client. Safe by default (H.264 / MPEG-2,
 *     8-bit, SDR); set TFS_UNKNOWN_CLIENTS=direct to treat them as capable.
 *
 * `copy=0` always means "transcode for me" (the client's own retry after a
 * failed pass-through).
 */

import { createHash } from "node:crypto";

/** Video codecs MPEG-TS can carry as-is. Anything else is always transcoded. */
export const TS_COPY_CODECS = ["h264", "hevc", "mpeg2video"] as const;

export type ClientCaps = {
  /** Short name: shared-hub key class and log label. */
  id: string;
  /** Where the answer came from. */
  source: "browser" | "declared" | "user-agent" | "legacy-copy" | "generic" | "forced";
  /** copy=0: always transcode. */
  forceTranscode: boolean;
  codecs: ReadonlySet<string>;
  /** HEVC Main 10 (10-bit). */
  hevc10: boolean;
  /** H.264 High 10 (almost no hardware decodes it). */
  h264High10: boolean;
  /** Decodes and displays HDR10 / HLG (PQ / HLG transfer). */
  hdr: boolean;
  /** Decodes Dolby Vision itself. Without it DV layers are stripped from a pass-through. */
  dv: boolean;
  /** Tallest picture the client decodes. 0 = no limit. */
  maxHeight: number;
  /** Highest video bitrate it can take as-is over its link. 0 = no limit. */
  maxKbps: number;
  /** When the source's format is unknown, trust the client and pass through. */
  trustUnknownSource: boolean;
  browser: boolean;
};

export const DEFAULT_DIRECT_MAX_KBPS = 40_000;
export const LEGACY_COPY_MAX_KBPS = 25_000;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function make(
  id: string,
  source: ClientCaps["source"],
  rest: Partial<ClientCaps>,
): ClientCaps {
  return {
    id,
    source,
    forceTranscode: false,
    codecs: new Set(["h264"]),
    hevc10: false,
    h264High10: false,
    hdr: false,
    dv: false,
    maxHeight: 0,
    maxKbps: 0,
    trustUnknownSource: false,
    browser: false,
    ...rest,
  };
}

/** The web player (mpegts.js in a browser): H.264, 8-bit, SDR. */
export function browserCaps(): ClientCaps {
  return make("browser", "browser", {
    codecs: new Set(["h264"]),
    maxHeight: 2160,
    maxKbps: envNumber("TFS_BROWSER_MAX_KBPS", LEGACY_COPY_MAX_KBPS),
    browser: true,
  });
}

/** MWS-TV on Android TV / Fire TV / Onn: hardware HEVC Main 10, HDR10. */
export function androidTvCaps(): ClientCaps {
  return make("tv", "user-agent", {
    codecs: new Set(["h264", "hevc", "mpeg2video"]),
    hevc10: true,
    hdr: envFlag("TFS_MWS_TV_HDR", true),
    maxHeight: 2160,
    maxKbps: envNumber("TFS_DIRECT_MAX_KBPS", DEFAULT_DIRECT_MAX_KBPS),
    trustUnknownSource: true,
  });
}

/** A known IPTV / media player: decodes HEVC, but we can't tell whether its screen shows HDR. */
export function knownPlayerCaps(): ClientCaps {
  return make("player", "user-agent", {
    codecs: new Set(["h264", "hevc", "mpeg2video"]),
    hevc10: true,
    maxHeight: 2160,
    maxKbps: LEGACY_COPY_MAX_KBPS,
  });
}

/** `copy=1` from an app we don't know: the pre-direct-play contract, unchanged. */
export function legacyCopyCaps(): ClientCaps {
  return make("legacy-copy", "legacy-copy", {
    codecs: new Set(["h264", "hevc", "mpeg2video"]),
    maxKbps: LEGACY_COPY_MAX_KBPS,
    trustUnknownSource: true,
  });
}

/** A client that tells us nothing. */
export function genericCaps(): ClientCaps {
  const policy = (process.env.TFS_UNKNOWN_CLIENTS || "safe").trim().toLowerCase();
  if (policy === "direct") {
    return make("generic", "generic", {
      codecs: new Set(["h264", "hevc", "mpeg2video"]),
      hevc10: true,
      maxHeight: 2160,
      maxKbps: LEGACY_COPY_MAX_KBPS,
      trustUnknownSource: true,
    });
  }
  if (policy === "transcode") {
    return make("generic", "generic", { codecs: new Set(), forceTranscode: true });
  }
  // Safe: HEVC 8-bit decodes on essentially every box sold in the last decade;
  // 10-bit, HDR and very high bitrates are where unknown devices fail.
  return make("generic", "generic", {
    codecs: new Set(["h264", "hevc", "mpeg2video"]),
    maxHeight: 2160,
    maxKbps: LEGACY_COPY_MAX_KBPS,
  });
}

/** Everyone who asked `copy=0`: transcode, shared by all of them. */
export function forcedTranscodeCaps(base: ClientCaps): ClientCaps {
  return { ...base, id: "transcode", forceTranscode: true };
}

const CODEC_WORDS: Record<string, string> = {
  h264: "h264",
  avc: "h264",
  hevc: "hevc",
  h265: "hevc",
  mpeg2: "mpeg2video",
  mpeg2video: "mpeg2video",
};

/**
 * Parse `hevc,hevc10,hdr,dv,h264-10,maxh=2160,maxkbps=40000` (commas or spaces).
 * Returns null when the value names nothing recognisable.
 */
export function parseCapsDeclaration(raw: string | null | undefined): ClientCaps | null {
  if (!raw) return null;
  const words = raw
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (!words.length) return null;
  const codecs = new Set<string>();
  let hevc10 = false;
  let h264High10 = false;
  let hdr = false;
  let dv = false;
  let maxHeight = 0;
  let maxKbps = envNumber("TFS_DIRECT_MAX_KBPS", DEFAULT_DIRECT_MAX_KBPS);
  let recognised = false;
  for (const word of words) {
    const [key, value] = word.split("=", 2);
    if (key === "maxh" || key === "maxheight") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) maxHeight = Math.floor(n);
      recognised = true;
    } else if (key === "maxkbps" || key === "maxbitrate") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) maxKbps = Math.floor(n);
      recognised = true;
    } else if (CODEC_WORDS[key]) {
      codecs.add(CODEC_WORDS[key]);
      recognised = true;
    } else if (key === "hevc10" || key === "main10" || key === "hevc-10") {
      hevc10 = true;
      codecs.add("hevc");
      recognised = true;
    } else if (key === "h264-10" || key === "h264hi10") {
      h264High10 = true;
      codecs.add("h264");
      recognised = true;
    } else if (key === "hdr" || key === "hdr10" || key === "hlg") {
      hdr = true;
      recognised = true;
    } else if (key === "dv" || key === "dovi") {
      dv = true;
      recognised = true;
    } else if (key === "none" || key === "sdr") {
      recognised = true;
    }
  }
  if (!recognised) return null;
  if (!codecs.size) codecs.add("h264");
  // HDR needs 10-bit video decode to be worth anything.
  if (hdr) {
    hevc10 = hevc10 || codecs.has("hevc");
  }
  const caps = make("custom", "declared", {
    codecs,
    hevc10,
    h264High10,
    hdr,
    dv,
    maxHeight,
    maxKbps,
    trustUnknownSource: true,
  });
  const signature = JSON.stringify([...codecs].sort().concat([`${+hevc10}${+h264High10}${+hdr}${+dv}`, `${maxHeight}`, `${maxKbps}`]));
  caps.id = `custom-${createHash("sha1").update(signature).digest("hex").slice(0, 6)}`;
  return caps;
}

const MWS_TV_UA = /\bMWS-TV\//i;
const KNOWN_PLAYER_UA =
  /\b(vlc|libvlc|kodi|xbmc|exoplayer|stagefright|tivimate|smarters|ott ?navigator|iptvnator|perfect ?player|gse|lavf|ffmpeg|mpv|jellyfin|plex|emby|infuse|nplayer|televizo|ipTV ?extreme|sparkle)\b/i;

export type CapsInput = {
  params: URLSearchParams;
  userAgent?: string | null;
  capsHeader?: string | null;
};

/** Work out the client's capabilities for one request. */
export function resolveClientCaps(input: CapsInput): ClientCaps {
  const { params } = input;
  const ua = input.userAgent || "";
  const copyParam = params.get("copy");
  const browser = params.get("browser") === "1";

  let caps: ClientCaps;
  const declared = parseCapsDeclaration(params.get("caps") ?? input.capsHeader);
  if (browser) {
    caps = browserCaps();
  } else if (declared) {
    caps = declared;
  } else if (MWS_TV_UA.test(ua)) {
    caps = androidTvCaps();
  } else if (copyParam === "1") {
    caps = legacyCopyCaps();
  } else if (KNOWN_PLAYER_UA.test(ua)) {
    caps = knownPlayerCaps();
  } else {
    caps = genericCaps();
  }

  if (copyParam === "0") {
    caps = caps.browser ? { ...caps, forceTranscode: true } : forcedTranscodeCaps(caps);
  }
  return caps;
}

export function describeCaps(caps: ClientCaps): string {
  const parts = [...caps.codecs];
  if (caps.hevc10) parts.push("10bit");
  if (caps.hdr) parts.push("hdr");
  if (caps.dv) parts.push("dv");
  if (caps.maxHeight) parts.push(`<=${caps.maxHeight}p`);
  if (caps.maxKbps) parts.push(`<=${Math.round(caps.maxKbps / 1000)}Mbps`);
  return `${caps.id}/${caps.source}${caps.forceTranscode ? " transcode-only" : ""}: ${parts.join(" ") || "nothing"}`;
}
