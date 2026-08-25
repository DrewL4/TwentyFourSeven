import { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { sharedLiveTranscodePool } from './shared-live-transcode';

export interface ProgramInfo {
  ratingKey: string;
  // Additional program info can be added as needed
}

export interface StreamSession {
  sessionId: string;
  channelNumber: number;
  ffmpegPid: number | null;
  ffmpegProcess: ChildProcess | null;
  startTime: Date;
  lastActivity: Date;
  lastOutputTimestamp: Date; // For detecting stalled streams
  clientIp?: string;
  programInfo: ProgramInfo;
  recoveryAttempts: number;
  status: 'active' | 'recovering' | 'failed' | 'circuit-open';
  lastError?: string;
  // Limit error history to prevent memory bloat (keep last 3 errors max)
  errorHistory: Array<{ timestamp: Date; error: string }>;
  // Recovery metadata
  restartedToSoftware: boolean;
  streamUrl?: string;
  seekSeconds: number;
  /** Live shared hub — capacity is per channel, not per episode. */
  sharedLive: boolean;
}

export class StreamMonitorService {
  private static instance: StreamMonitorService;
  private sessions: Map<string, StreamSession> = new Map();
  private sessionTimeout: number;

  private constructor() {
    // Default idle timeout: 2 minutes — reclaim orphan FFmpeg after channel flips
    this.sessionTimeout = parseInt(
      process.env.STREAM_SESSION_TIMEOUT || '120000',
      10
    );
  }

  static getInstance(): StreamMonitorService {
    if (!StreamMonitorService.instance) {
      StreamMonitorService.instance = new StreamMonitorService();
    }
    return StreamMonitorService.instance;
  }

  /**
   * Create a new stream session
   */
  createSession(
    channelNumber: number,
    programInfo: ProgramInfo,
    clientIp?: string,
    options?: { sharedLive?: boolean },
  ): string {
    const sessionId = randomUUID();
    const now = new Date();

    const session: StreamSession = {
      sessionId,
      channelNumber,
      ffmpegPid: null,
      ffmpegProcess: null,
      startTime: now,
      lastActivity: now,
      lastOutputTimestamp: now,
      clientIp,
      programInfo,
      recoveryAttempts: 0,
      status: 'active',
      errorHistory: [],
      restartedToSoftware: false,
      seekSeconds: 0,
      sharedLive: options?.sharedLive === true,
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Update FFmpeg process reference for a session
   */
  setFfmpegProcess(sessionId: string, process: ChildProcess | null): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ffmpegPid = process?.pid ?? null;
      // Keep a weak handle for same-session kill paths; shared live hubs
      // own the ChildProcess separately and kill via the pool.
      session.ffmpegProcess = process;
      // Do not refresh lastActivity — process swaps happen while encoder runs
      // and must not reset the idle timer for orphan cleanup.
    }
  }

  /** Propagate the same FFmpeg PID to every session in a shared live hub. */
  setFfmpegPidForSessions(
    sessionIds: string[],
    process: ChildProcess | null,
  ): void {
    const pid = process?.pid ?? null;
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.ffmpegPid = pid;
        session.ffmpegProcess = null;
      }
    }
  }

  private killFfmpegForSession(session: StreamSession): void {
    if (session.ffmpegProcess) {
      try {
        session.ffmpegProcess.kill("SIGKILL");
      } catch {
        // ignore
      }
      return;
    }
    if (session.ffmpegPid) {
      try {
        process.kill(session.ffmpegPid, "SIGKILL");
      } catch {
        // ignore — process may already be gone
      }
    }
  }

  /**
   * FFmpeg produced media output — for stall detection only.
   * Do NOT refresh lastActivity here: encoder output would keep orphaned
   * sessions forever after the client disconnects without an abort.
   */
  updateOutputActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastOutputTimestamp = new Date();
    }
  }

  /**
   * Client-side activity (connect, metadata, recovery ownership).
   * Used by stale-session cleanup — must not be driven by FFmpeg I/O.
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Add error to session history (limited to last 3 errors)
   */
  addError(sessionId: string, error: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastError = error;
      session.errorHistory.push({
        timestamp: new Date(),
        error,
      });

      // Keep only last 3 errors (circular buffer)
      if (session.errorHistory.length > 3) {
        session.errorHistory.shift();
      }
    }
  }

  /**
   * Update session status
   */
  updateStatus(
    sessionId: string,
    status: StreamSession['status']
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.lastActivity = new Date();
    }
  }

  /**
   * Increment recovery attempts
   */
  incrementRecoveryAttempts(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.recoveryAttempts++;
      session.lastActivity = new Date();
    }
  }

  /**
   * Reset recovery attempts (on successful recovery)
   */
  resetRecoveryAttempts(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.recoveryAttempts = 0;
      session.lastActivity = new Date();
    }
  }

  /**
   * Update session metadata for recovery
   */
  updateSessionMetadata(
    sessionId: string,
    updates: Partial<Pick<StreamSession, 'programInfo' | 'streamUrl' | 'seekSeconds' | 'restartedToSoftware'>>
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
      session.lastActivity = new Date();
    }
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): StreamSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): StreamSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions by channel number
   */
  getSessionsByChannel(channelNumber: number): StreamSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.channelNumber === channelNumber
    );
  }

  /**
   * Get active sessions (not failed or circuit-open)
   */
  getActiveSessions(): StreamSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'active' || s.status === 'recovering'
    );
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): boolean {
    // Shared live hubs own FFmpeg — release the viewer slot instead of
    // killing by PID (which would drop every client on that channel).
    if (sharedLiveTranscodePool.hasViewer(sessionId)) {
      sharedLiveTranscodePool.releaseViewer(sessionId);
      return this.sessions.delete(sessionId);
    }
    const session = this.sessions.get(sessionId);
    if (session) {
      this.killFfmpegForSession(session);
    }
    return this.sessions.delete(sessionId);
  }

  /** Drop session metadata without killing FFmpeg (caller already stopped the process). */
  dropSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clean up stale sessions (lazy cleanup).
   * Uses lastActivity (client interest), NOT FFmpeg output timestamps —
   * otherwise orphaned encoders that keep writing would never expire.
   */
  cleanupStaleSessions(): number {
    const now = Date.now();
    const staleThreshold = now - this.sessionTimeout;
    let cleaned = 0;

    // Drop shared-live viewers whose HTTP stream already closed without abort.
    for (const sessionId of sharedLiveTranscodePool.releaseDestroyedViewers()) {
      this.sessions.delete(sessionId);
      cleaned++;
    }
    for (const [sessionId, session] of this.sessions.entries()) {
      const lastActivityTime = session.lastActivity.getTime();

      // Remove if stale (older than timeout)
      if (lastActivityTime < staleThreshold) {
        // Joiners never get metadata/handoff activity pings. If their HTTP
        // passthrough is still open they are watching — do not reclaim.
        if (this.hasOpenLiveViewer(sessionId)) {
          continue;
        }
        this.removeSession(sessionId);
        cleaned++;
        continue;
      }

      // Also clean up failed sessions that are old
      if (
        session.status === 'failed' &&
        lastActivityTime < now - 300000 // 5 minutes for failed sessions
      ) {
        this.removeSession(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  private hasOpenLiveViewer(sessionId: string): boolean {
    const hub = sharedLiveTranscodePool.getHubForSession(sessionId);
    const viewer = hub?.viewers.get(sessionId);
    if (!viewer) {
      return false;
    }
    return (
      !viewer.passthrough.destroyed &&
      !viewer.passthrough.writableEnded &&
      !(viewer.passthrough as { closed?: boolean }).closed
    );
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    return this.getActiveSessions().length;
  }

  /**
   * Check if session exists and is active
   */
  isSessionActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return (
      session !== undefined &&
      (session.status === 'active' || session.status === 'recovering')
    );
  }
}

export const streamMonitorService = StreamMonitorService.getInstance();

