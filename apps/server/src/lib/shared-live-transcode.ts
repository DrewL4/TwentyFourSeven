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
};

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
    this.hubs.clear();
    this.pendingCreates.clear();
  }

  /**
   * One live hub per channel (not per episode). Episode handoff keeps the
   * same MPEG-TS HTTP response and late joiners attach mid-stream.
   */
  getLiveShareKey(channelNumber: number, _ratingKey?: string): string {
    return `${channelNumber}:live`;
  }

  getHub(key: string): SharedLiveHub | undefined {
    return this.hubs.get(key);
  }

  findLiveHub(
    channelNumber: number,
    ratingKey: string,
  ): SharedLiveHub | undefined {
    return this.hubs.get(this.getLiveShareKey(channelNumber, ratingKey));
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
  }): Promise<{ hub: SharedLiveHub; shouldStartFfmpeg: boolean }> {
    const key = this.getLiveShareKey(options.channelNumber, options.ratingKey);

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
  }): SharedLiveHub {
    const key = this.getLiveShareKey(options.channelNumber, options.ratingKey);
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
    hub.viewers.set(sessionId, { sessionId, passthrough });
  }

  /**
   * Wire FFmpeg stdout to all current (and future) viewers via chunk fan-out.
   * Slow clients that back-pressure are dropped so they cannot stall the hub.
   */
  attachFfmpeg(hub: SharedLiveHub, child: ChildProcess): void {
    this.stopHandoffStuffing(hub);
    hub.ffmpeg = child;
    this.clearPendingCreate(hub.key);

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const viewer of hub.viewers.values()) {
        if (viewer.passthrough.destroyed || viewer.passthrough.writableEnded) {
          continue;
        }
        try {
          const ok = viewer.passthrough.write(chunk);
          if (!ok) {
            viewer.passthrough.destroy();
          }
        } catch {
          // ignore write errors from disconnected clients
        }
      }
    });
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
      this.stopHandoffStuffing(hub);
      this.killHubFfmpeg(hub);
      this.hubs.delete(hub.key);
      return { wasInPool: true, killedFfmpeg: true, hubKey: hub.key };
    }

    if (hub.ownerSessionId === sessionId) {
      const nextOwner = hub.viewers.keys().next().value as string;
      hub.ownerSessionId = nextOwner;
    }

    return { wasInPool: true, killedFfmpeg: false, hubKey: hub.key };
  }

  /** End all viewer streams and remove hub (FFmpeg already exiting). */
  dissolveHub(hub: SharedLiveHub, options?: { killFfmpeg?: boolean }): void {
    this.clearPendingCreate(hub.key);
    this.stopHandoffStuffing(hub);
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
    this.hubs.delete(hub.key);
  }

  private startHandoffStuffing(hub: SharedLiveHub): void {
    this.stopHandoffStuffing(hub);
    const burst = createMpegTsNullBurst();
    const timer = setInterval(() => {
      for (const viewer of hub.viewers.values()) {
        if (viewer.passthrough.destroyed || viewer.passthrough.writableEnded) {
          continue;
        }
        try {
          // Never destroy slow clients for stuffing — skip if back-pressured.
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
