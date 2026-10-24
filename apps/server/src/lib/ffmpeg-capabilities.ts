import { spawn } from "child_process";

/**
 * `-readrate_initial_burst` exists from FFmpeg 6.1. The image ships Debian
 * bookworm FFmpeg 5.1, which rejects the flag and exits before the first TS
 * packet. FFMPEG_READRATE_INITIAL_BURST=true|false overrides the probe.
 *
 * The probe runs in the background (started at boot by `warmFfmpegCapabilities`).
 * It used to be a `spawnSync` on the first play, which froze the whole server
 * (every request, every stream) for up to 10 s while `ffmpeg -h full` ran.
 * Until the answer is known the flag is left out, which is always safe.
 */

type CapabilityState = { initialBurst?: boolean; probing?: Promise<boolean> };

// globalThis so the boot hook and the route bundles share one answer.
const KEY = Symbol.for("tfs.ffmpegCapabilities");
function state(): CapabilityState {
  const g = globalThis as unknown as Record<symbol, CapabilityState | undefined>;
  return (g[KEY] ??= {});
}

function override(): boolean | undefined {
  const value = process.env.FFMPEG_READRATE_INITIAL_BURST?.toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

type Spawner = typeof spawn;

/** Start (or join) the background probe. Resolves to the answer; never rejects. */
export function warmFfmpegCapabilities(
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  spawner: Spawner = spawn,
  timeoutMs = 10_000,
): Promise<boolean> {
  const s = state();
  const forced = override();
  if (forced !== undefined) {
    s.initialBurst = forced;
    return Promise.resolve(forced);
  }
  if (s.initialBurst !== undefined) return Promise.resolve(s.initialBurst);
  if (s.probing) return s.probing;
  s.probing = new Promise<boolean>((resolve) => {
    let out = "";
    let found = false;
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.initialBurst = value;
      s.probing = undefined;
      resolve(value);
    };
    let child: ReturnType<Spawner>;
    try {
      child = spawner(ffmpegPath, ["-hide_banner", "-h", "full"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
        child.stdout?.destroy();
      } catch {
        // ignore
      }
      finish(found);
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (found) return;
      // Keep a short tail so a flag split across chunks still matches.
      out = (out + chunk).slice(-4096);
      if (/-readrate_initial_burst\b/.test(out)) found = true;
    });
    child.on("error", () => finish(false));
    child.on("close", () => finish(found));
  });
  return s.probing;
}

/** Answer for building FFmpeg args right now. Never blocks; false until probed. */
export function ffmpegSupportsReadrateInitialBurst(ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg"): boolean {
  const forced = override();
  if (forced !== undefined) return forced;
  const s = state();
  if (s.initialBurst !== undefined) return s.initialBurst;
  void warmFfmpegCapabilities(ffmpegPath);
  return false;
}

/** Tests only. */
export function resetFfmpegCapabilitiesForTests(): void {
  const s = state();
  s.initialBurst = undefined;
  s.probing = undefined;
}
