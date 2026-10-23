import { spawnSync } from "child_process";

let initialBurstSupported: boolean | undefined;

/**
 * `-readrate_initial_burst` exists from FFmpeg 6.1. The image ships Debian
 * bookworm FFmpeg 5.1, which rejects the flag and exits before the first TS
 * packet. Probe once, cache the answer. FFMPEG_READRATE_INITIAL_BURST=true|false
 * overrides the probe.
 */
export function ffmpegSupportsReadrateInitialBurst(ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg"): boolean {
  if (initialBurstSupported !== undefined) {
    return initialBurstSupported;
  }
  const override = process.env.FFMPEG_READRATE_INITIAL_BURST?.toLowerCase();
  if (override === "true" || override === "1") {
    initialBurstSupported = true;
    return true;
  }
  if (override === "false" || override === "0") {
    initialBurstSupported = false;
    return false;
  }
  try {
    const result = spawnSync(ffmpegPath, ["-hide_banner", "-h", "full"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10_000,
    });
    initialBurstSupported = /-readrate_initial_burst\b/.test(`${result.stdout ?? ""}`);
  } catch {
    initialBurstSupported = false;
  }
  return initialBurstSupported;
}
