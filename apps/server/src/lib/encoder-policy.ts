/**
 * When TFS has to re-encode video, it does it on the GPU. This module keeps
 * the rule honest: the CPU encoder (libx264) is a last resort that is never
 * entered silently. Every step off the GPU is logged at error level with the
 * reason, counted, and visible through `gpuHealth()`.
 *
 * TFS_SOFTWARE_FALLBACK=loud (default)  last resort is allowed, loudly
 * TFS_SOFTWARE_FALLBACK=never           no CPU encode: the stream fails instead
 */

import { encoderFamily } from "./ffmpeg-live-args";

export type SoftwareFallbackPolicy = "loud" | "never";

export function softwareFallbackPolicy(): SoftwareFallbackPolicy {
  return process.env.TFS_SOFTWARE_FALLBACK?.trim().toLowerCase() === "never" ? "never" : "loud";
}

export type GpuHealth = {
  state: "unknown" | "ok" | "degraded";
  /** Last time an encode left the GPU path, ISO. */
  lastFallbackAt: string | null;
  lastReason: string | null;
  /** Encodes that ran on the CPU because the GPU path failed, since boot. */
  cpuFallbacks: number;
  /** Transcodes that were configured for the CPU (no GPU encoder selected). */
  cpuConfiguredTranscodes: number;
};

const KEY = Symbol.for("tfs.gpuHealth");
function health(): GpuHealth {
  const g = globalThis as unknown as Record<symbol, GpuHealth | undefined>;
  return (g[KEY] ??= {
    state: "unknown",
    lastFallbackAt: null,
    lastReason: null,
    cpuFallbacks: 0,
    cpuConfiguredTranscodes: 0,
  });
}

export function gpuHealth(): Readonly<GpuHealth> {
  return { ...health() };
}

export function resetGpuHealthForTests(): void {
  const h = health();
  h.state = "unknown";
  h.lastFallbackAt = null;
  h.lastReason = null;
  h.cpuFallbacks = 0;
  h.cpuConfiguredTranscodes = 0;
}

type Log = (message: string) => void;

/** A GPU encode produced output: the GPU path works. */
export function noteGpuEncodeOk(): void {
  const h = health();
  if (h.state !== "ok") h.state = "ok";
}

/**
 * The GPU path failed and the stream is about to run on a lesser path
 * (`cpu-decode`: GPU encode only, or `software`: libx264). Returns false when
 * policy forbids the CPU encode and the stream must fail instead.
 */
export function reportGpuStepDown(
  channel: number,
  from: string,
  to: "hardware" | "cpu-decode" | "software",
  reason: string,
  log: { warn: Log; error: Log } = console,
): boolean {
  const h = health();
  h.state = "degraded";
  h.lastFallbackAt = new Date().toISOString();
  h.lastReason = reason.replace(/\s+/g, " ").slice(0, 200);
  if (to === "software") {
    if (softwareFallbackPolicy() === "never") {
      log.error(
        `[GPU] channel=${channel} GPU ${from} encode failed (${h.lastReason}). CPU encode is disabled (TFS_SOFTWARE_FALLBACK=never): stream stopped`,
      );
      return false;
    }
    h.cpuFallbacks++;
    log.error(
      `[GPU] channel=${channel} GPU ${from} encode failed (${h.lastReason}). FALLING BACK TO CPU libx264: this stream is re-encoding on the CPU. Check the NVIDIA driver, nvidia-container-toolkit and /dev/nvidia*`,
    );
  } else {
    log.warn(`[GPU] channel=${channel} GPU ${from} failed (${h.lastReason}). Retrying with CPU decode + GPU encode`);
  }
  return true;
}

/** A transcode is starting although the settings select a CPU encoder. Logged at most once a minute. */
let lastConfiguredWarn = 0;
export function noteCpuConfiguredTranscode(
  channel: number,
  videoCodec: string | null | undefined,
  log: { warn: Log } = console,
  now = Date.now(),
): void {
  const codec = videoCodec || "libx264";
  if (encoderFamily(codec) !== "software") return;
  health().cpuConfiguredTranscodes++;
  if (now - lastConfiguredWarn < 60_000) return;
  lastConfiguredWarn = now;
  log.warn(
    `[GPU] channel=${channel} this program has to be transcoded but the FFmpeg setting is ${codec} (CPU). Select an NVENC codec (h264_nvenc) in Settings so transcodes run on the GPU`,
  );
}

export function resetCpuConfiguredWarnForTests(): void {
  lastConfiguredWarn = 0;
}
