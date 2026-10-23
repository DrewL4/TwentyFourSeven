import type { ChildProcess } from "child_process";
import { PassThrough } from "stream";

export const MPEG_TS_PACKET_SIZE = 188;

/** Standard MPEG-TS null packet (PID 0x1FFF) — players ignore these. */
export function createMpegTsNullPacket(): Buffer {
  const packet = Buffer.alloc(MPEG_TS_PACKET_SIZE, 0xff);
  packet[0] = 0x47;
  packet[1] = 0x1f;
  packet[2] = 0xff;
  packet[3] = 0x10;
  return packet;
}

/** One typical MPEG-TS burst (7 × 188 bytes) used to keep HTTP/TCP alive. */
export function createMpegTsNullBurst(packetCount = 7): Buffer {
  const packet = createMpegTsNullPacket();
  return Buffer.concat(Array.from({ length: packetCount }, () => packet));
}

export type SharedLiveViewer = {
  sessionId: string;
  passthrough: PassThrough;
  /** Waiting for one `drain` — at most one listener per viewer. */
  awaitingDrain?: boolean;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Bytes a viewer may fall behind the shared encoder before it is cut loose.
 * Each viewer's backlog lives in Node's heap, so without a cap one stalled
 * client grows RSS without bound. 12 MB is ~25 s of 4 Mbps video.
 */
export function liveMaxViewerLagBytes(): number {
  return Math.round(envNumber("TFS_LIVE_MAX_VIEWER_LAG_MB", 12) * 1024 * 1024);
}

/** FFmpeg paused because every viewer is stalled: give up after this long. */
export function liveStallTimeoutMs(): number {
  return envNumber("TFS_LIVE_STALL_TIMEOUT_MS", 120_000);
}

/**
 * Keep a channel's FFmpeg running this long after the last viewer leaves.
 * IPTV clients (Plex, Jellyfin, TiviMate) probe-then-reopen and zap back and
 * forth; reusing the warm encoder avoids a second spawn and seek. 0 disables.
 */
export function liveIdleGraceMs(): number {
  return envNumber("TFS_LIVE_IDLE_GRACE_MS", 15_000);
}

function isWritable(viewer: SharedLiveViewer): boolean {
  return !viewer.passthrough.destroyed && !viewer.passthrough.writableEnded;
}

export type SharedLiveHub = {
  key: string;
  channelNumber: number;
  ratingKey: string;
  /** Session that owns recovery / FFmpeg lifecycle callbacks. */
  ownerSessionId: string;
  ffmpeg: ChildProcess | null;
  viewers: Map<string, SharedLiveViewer>;
  streamUrl: string;
  seekSeconds: number;
  restartedToSoftware: boolean;
  /** Remux hub (`copy=1`) — never mixed with a transcode hub on the same channel. */
  copy: boolean;
  /** Set while the hub has no viewers and waits for a re-tune (idle grace). */
  idleTimer?: ReturnType<typeof setTimeout> | null;
  /** Set while FFmpeg stdout is paused because all viewers are backpressured. */
  stallTimer?: ReturnType<typeof setTimeout> | null;
};

/**
 * One live FFmpeg per channel+program, fan-out to all viewers.
 * Catchup/timeshift must not use this — seekers need distinct offsets.
 */
export class SharedLiveTranscodePool {
  private static instance: SharedLiveTranscodePool;
  private hubs: Map<string, SharedLiveHub> = new Map();
  /** In-flight hub creation so two first viewers cannot each spawn FFmpeg. */
  private pendingCreates: Map<string, Promise<SharedLiveHub>> = new Map();
  /** Keepalive stuffing while FFmpeg is between episodes / GPU fallback. */
  private stuffingTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  static getInstance(): SharedLiveTranscodePool {
    if (!SharedLiveTranscodePool.instance) {
      SharedLiveTranscodePool.instance = new SharedLiveTranscodePool();
    }
    return SharedLiveTranscodePool.instance;
  }

  /** Test helper — clears all hubs without killing processes. */
  resetForTests(): void {
    for (const timer of this.stuffingTimers.values()) {
      clearInterval(timer);
    }
    this.stuffingTimers.clear();
    for (const hub of this.hubs.values()) {
      this.clearHubTimers(hub);
    }
    this.hubs.clear();
    this.pendingCreates.clear();
  }

  /**
   * One live hub per channel and encode mode (copy vs transcode). Episode
   * handoff keeps the same MPEG-TS HTTP response; late joiners attach only
   * to the hub that matches their copy flag.
   */
  getLiveShareKey(
    channelNumber: number,
    _ratingKey?: string,
    copy = false,
    browser = false,
  ): string {
    if (browser) {
      return `${channelNumber}:live:browser`;
    }
    return `${channelNumber}:live:${copy ? "copy" : "transcode"}`;
  }

  getHub(key: string): SharedLiveHub | undefined {
    return this.hubs.get(key);
  }

  findLiveHub(
    channelNumber: number,
    ratingKey: string,
    copy = false,
    browser = false,
  ): SharedLiveHub | undefined {
    return this.hubs.get(this.getLiveShareKey(channelNumber, ratingKey, copy, browser));
  }

  /** True when this session is attached to a shared live hub. */
  hasViewer(sessionId: string): boolean {
    for (const hub of this.hubs.values()) {
      if (hub.viewers.has(sessionId)) {
        return true;
      }
    }
    return false;
  }

  isOwner(sessionId: string): boolean {
    for (const hub of this.hubs.values()) {
      if (hub.ownerSessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  getHubForSession(sessionId: string): SharedLiveHub | undefined {
    for (const hub of this.hubs.values()) {
      if (hub.viewers.has(sessionId)) {
        return hub;
      }
    }
    return undefined;
  }

  /**
   * Join an existing live hub or create one. Only the creator should spawn FFmpeg.
   */
  async joinOrCreateLiveHub(options: {
    channelNumber: number;
    ratingKey: string;
    sessionId: string;
    streamUrl: string;
    seekSeconds: number;
    passthrough: PassThrough;
    copy?: boolean;
    browser?: boolean;
  }): Promise<{ hub: SharedLiveHub; shouldStartFfmpeg: boolean }> {
    const key = this.getLiveShareKey(
      options.channelNumber,
      options.ratingKey,
      options.copy === true,
      options.browser === true,
    );

    const existing = this.hubs.get(key);
    if (existing) {
      this.addViewer(existing, options.sessionId, options.passthrough);
      // Do not overwrite hub streamUrl/seekSeconds — late joiners attach
      // mid-stream. Mutating those fields would poison recovery/handoff.
      return { hub: existing, shouldStartFfmpeg: false };
    }

    const pending = this.pendingCreates.get(key);
    if (pending) {
      const hub = await pending;
      this.addViewer(hub, options.sessionId, options.passthrough);
      return { hub, shouldStartFfmpeg: false };
    }

    let resolveHub!: (hub: SharedLiveHub) => void;
    const createPromise = new Promise<SharedLiveHub>((resolve) => {
      resolveHub = resolve;
    });
    this.pendingCreates.set(key, createPromise);

    try {
      const hub = this.createHub({
        channelNumber: options.channelNumber,
        ratingKey: options.ratingKey,
        ownerSessionId: options.sessionId,
        streamUrl: options.streamUrl,
        seekSeconds: options.seekSeconds,
        passthrough: options.passthrough,
        copy: options.copy === true,
        browser: options.browser === true,
      });
      resolveHub(hub);
      return { hub, shouldStartFfmpeg: true };
    } catch (error) {
      this.pendingCreates.delete(key);
      throw error;
    }
  }

  /** Clear the create lock once FFmpeg is attached (or creation failed). */
  clearPendingCreate(key: string): void {
    this.pendingCreates.delete(key);
  }

  createHub(options: {
    channelNumber: number;
    ratingKey: string;
    ownerSessionId: string;
    streamUrl: string;
    seekSeconds: number;
    passthrough: PassThrough;
    copy?: boolean;
    browser?: boolean;
  }): SharedLiveHub {
    const key = this.getLiveShareKey(
      options.channelNumber,
      options.ratingKey,
      options.copy === true,
      options.browser === true,
    );
    const existing = this.hubs.get(key);
    if (existing) {
      this.addViewer(existing, options.ownerSessionId, options.passthrough);
      return existing;
    }

    const hub: SharedLiveHub = {
      key,
      channelNumber: options.channelNumber,
      ratingKey: options.ratingKey,
      ownerSessionId: options.ownerSessionId,
      ffmpeg: null,
      viewers: new Map(),
      streamUrl: options.streamUrl,
      seekSeconds: options.seekSeconds,
      restartedToSoftware: false,
      copy: options.copy === true,
    };
    hub.viewers.set(options.ownerSessionId, {
      sessionId: options.ownerSessionId,
      passthrough: options.passthrough,
    });
    this.hubs.set(key, hub);
    return hub;
  }

  addViewer(
    hub: SharedLiveHub,
    sessionId: string,
    passthrough: PassThrough,
  ): void {
    if (hub.idleTimer) {
      clearTimeout(hub.idleTimer);
      hub.idleTimer = null;
    }
    hub.viewers.set(sessionId, { sessionId, passthrough });
    if (!hub.viewers.has(hub.ownerSessionId)) {
      // Joined a hub kept warm by idle grace: this viewer owns it now.
      hub.ownerSessionId = sessionId;
    }
  }

  /** True while the hub is still registered (not dissolved or reaped). */
  isHubActive(hub: SharedLiveHub): boolean {
    return this.hubs.get(hub.key) === hub;
  }

  /**
   * Wire FFmpeg stdout to all current (and future) viewers via chunk fan-out.
   *
   * Live input is paced at 1x, so a healthy viewer keeps up. FFmpeg pauses
   * only when every viewer is backpressured (the fastest viewer sets the pace),
   * a viewer that falls more than `liveMaxViewerLagBytes()` behind is cut loose,
   * and an all-stalled hub is torn down after `liveStallTimeoutMs()`. Every
   * viewer's backlog is bounded, so Node RSS cannot grow with stalled clients.
   */
  attachFfmpeg(hub: SharedLiveHub, child: ChildProcess): void {
    this.stopHandoffStuffing(hub);
    this.clearStallTimer(hub);
    hub.ffmpeg = child;
    this.clearPendingCreate(hub.key);

    const stdout = child.stdout;
    if (!stdout) {
      return;
    }
    const maxLag = liveMaxViewerLagBytes();

    const resumeIfAnyReady = () => {
      if (hub.ffmpeg !== child || !stdout.isPaused()) {
        return;
      }
      const viewers = [...hub.viewers.values()].filter(isWritable);
      if (viewers.length === 0 || viewers.some((viewer) => !viewer.awaitingDrain)) {
        this.clearStallTimer(hub);
        stdout.resume();
      }
    };

    stdout.on("data", (chunk: Buffer) => {
      const viewers = [...hub.viewers.values()].filter(isWritable);
      let ready = 0;
      for (const viewer of viewers) {
        const pass = viewer.passthrough;
        if (pass.writableLength > maxLag) {
          // Too far behind the live edge: drop it so its backlog is freed.
          // The route's close handler releases the session.
          pass.destroy();
          continue;
        }
        let ok = true;
        try {
          ok = pass.write(chunk);
        } catch {
          // ignore write errors from disconnected clients
          continue;
        }
        if (ok) {
          ready++;
          continue;
        }
        if (!viewer.awaitingDrain) {
          viewer.awaitingDrain = true;
          pass.once("drain", () => {
            viewer.awaitingDrain = false;
            resumeIfAnyReady();
          });
        }
      }
      if (viewers.length > 0 && ready === 0 && !stdout.isPaused()) {
        stdout.pause();
        this.armStallTimer(hub, child);
      }
    });
  }

  private armStallTimer(hub: SharedLiveHub, child: ChildProcess): void {
    const timeout = liveStallTimeoutMs();
    if (timeout <= 0 || hub.stallTimer) {
      return;
    }
    hub.stallTimer = setTimeout(() => {
      hub.stallTimer = null;
      if (hub.ffmpeg !== child || !child.stdout?.isPaused()) {
        return;
      }
      for (const viewer of hub.viewers.values()) {
        if (viewer.awaitingDrain && isWritable(viewer)) {
          viewer.passthrough.destroy();
        }
      }
    }, timeout);
    hub.stallTimer.unref?.();
  }

  private clearStallTimer(hub: SharedLiveHub): void {
    if (hub.stallTimer) {
      clearTimeout(hub.stallTimer);
      hub.stallTimer = null;
    }
  }

  private clearHubTimers(hub: SharedLiveHub): void {
    this.clearStallTimer(hub);
    if (hub.idleTimer) {
      clearTimeout(hub.idleTimer);
      hub.idleTimer = null;
    }
  }

  setRestartedToSoftware(hub: SharedLiveHub, value: boolean): void {
    hub.restartedToSoftware = value;
  }

  /** Update the program this hub is currently transcoding (episode handoff). */
  updateHubProgram(
    hub: SharedLiveHub,
    options: { ratingKey: string; streamUrl: string; seekSeconds: number },
  ): void {
    hub.ratingKey = options.ratingKey;
    hub.streamUrl = options.streamUrl;
    hub.seekSeconds = options.seekSeconds;
    this.beginEncoderGap(hub);
  }

  /**
   * FFmpeg is gone but HTTP clients are still connected (episode handoff,
   * GPU software fallback, recovery). Stuff null TS packets so players do
   * not hit read-timeout / STATE_ENDED during the spawn gap.
   */
  beginEncoderGap(hub: SharedLiveHub): void {
    hub.ffmpeg = null;
    this.startHandoffStuffing(hub);
  }

  /**
   * Detach viewers whose passthrough already ended (client gone, abort missed).
   * Returns session IDs that were released (caller should drop monitor sessions).
   */
  releaseDestroyedViewers(): string[] {
    const releasedSessionIds: string[] = [];
    for (const hub of [...this.hubs.values()]) {
      for (const [sessionId, viewer] of [...hub.viewers.entries()]) {
        if (
          viewer.passthrough.destroyed ||
          viewer.passthrough.writableEnded ||
          (viewer.passthrough as { closed?: boolean }).closed
        ) {
          this.releaseViewer(sessionId);
          releasedSessionIds.push(sessionId);
        }
      }
    }
    return releasedSessionIds;
  }

  /**
   * Detach a viewer. Kills FFmpeg only when the last viewer leaves.
   * Promotes a new owner when the previous owner leaves with others remaining.
   */
  releaseViewer(sessionId: string): {
    wasInPool: boolean;
    killedFfmpeg: boolean;
    hubKey?: string;
    /** Hub kept warm with no viewers (idle grace). */
    idle?: boolean;
  } {
    const hub = this.getHubForSession(sessionId);
    if (!hub) {
      return { wasInPool: false, killedFfmpeg: false };
    }

    const viewer = hub.viewers.get(sessionId);
    if (viewer && !viewer.passthrough.destroyed) {
      try {
        viewer.passthrough.end();
      } catch {
        // ignore
      }
    }
    hub.viewers.delete(sessionId);

    if (hub.viewers.size === 0) {
      const graceMs = liveIdleGraceMs();
      if (graceMs > 0 && hub.ffmpeg) {
        this.stopHandoffStuffing(hub);
        this.clearStallTimer(hub);
        hub.ffmpeg.stdout?.resume();
        if (hub.idleTimer) {
          clearTimeout(hub.idleTimer);
        }
        hub.idleTimer = setTimeout(() => {
          hub.idleTimer = null;
          if (hub.viewers.size === 0 && this.hubs.get(hub.key) === hub) {
            this.reapHub(hub);
          }
        }, graceMs);
        hub.idleTimer.unref?.();
        return { wasInPool: true, killedFfmpeg: false, hubKey: hub.key, idle: true };
      }
      this.reapHub(hub);
      return { wasInPool: true, killedFfmpeg: true, hubKey: hub.key };
    }

    if (hub.ownerSessionId === sessionId) {
      const nextOwner = hub.viewers.keys().next().value as string;
      hub.ownerSessionId = nextOwner;
    }

    return { wasInPool: true, killedFfmpeg: false, hubKey: hub.key };
  }

  private reapHub(hub: SharedLiveHub): void {
    this.clearHubTimers(hub);
    this.stopHandoffStuffing(hub);
    this.killHubFfmpeg(hub);
    this.clearPendingCreate(hub.key);
    if (this.hubs.get(hub.key) === hub) {
      this.hubs.delete(hub.key);
    }
  }

  /** End all viewer streams and remove hub (FFmpeg already exiting). */
  dissolveHub(hub: SharedLiveHub, options?: { killFfmpeg?: boolean }): void {
    this.clearPendingCreate(hub.key);
    this.stopHandoffStuffing(hub);
    this.clearHubTimers(hub);
    if (options?.killFfmpeg !== false) {
      this.killHubFfmpeg(hub);
    }
    for (const viewer of hub.viewers.values()) {
      if (!viewer.passthrough.destroyed && !viewer.passthrough.writableEnded) {
        try {
          viewer.passthrough.end();
        } catch {
          // ignore
        }
      }
    }
    hub.viewers.clear();
    if (this.hubs.get(hub.key) === hub) {
      this.hubs.delete(hub.key);
    }
  }

  private startHandoffStuffing(hub: SharedLiveHub): void {
    this.stopHandoffStuffing(hub);
    const burst = createMpegTsNullBurst();
    const timer = setInterval(() => {
      for (const viewer of hub.viewers.values()) {
        if (viewer.passthrough.destroyed || viewer.passthrough.writableEnded) {
          continue;
        }
        // Never destroy slow clients for stuffing — skip if back-pressured,
        // otherwise 25 bursts/s pile up in a stalled viewer's buffer.
        if (viewer.passthrough.writableLength >= viewer.passthrough.writableHighWaterMark) {
          continue;
        }
        try {
          viewer.passthrough.write(burst);
        } catch {
          // ignore write errors from disconnected clients
        }
      }
    }, 40);
    this.stuffingTimers.set(hub.key, timer);
  }

  private stopHandoffStuffing(hub: SharedLiveHub): void {
    const timer = this.stuffingTimers.get(hub.key);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    this.stuffingTimers.delete(hub.key);
  }

  private killHubFfmpeg(hub: SharedLiveHub): void {
    if (!hub.ffmpeg) {
      return;
    }
    try {
      hub.ffmpeg.kill("SIGKILL");
    } catch {
      // ignore
    }
    hub.ffmpeg = null;
  }
}

export const sharedLiveTranscodePool = SharedLiveTranscodePool.getInstance();
