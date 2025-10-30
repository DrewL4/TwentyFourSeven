import { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

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
}

export class StreamMonitorService {
  private static instance: StreamMonitorService;
  private sessions: Map<string, StreamSession> = new Map();
  private sessionTimeout: number;

  private constructor() {
    // Default session timeout: 10 minutes (600000ms)
    this.sessionTimeout = parseInt(
      process.env.STREAM_SESSION_TIMEOUT || '600000',
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
    clientIp?: string
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
      session.ffmpegProcess = process;
      session.ffmpegPid = process?.pid ?? null;
      session.lastActivity = new Date();
    }
  }

  /**
   * Update output activity timestamp (called on data events)
   */
  updateOutputActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastOutputTimestamp = new Date();
      session.lastActivity = new Date();
    }
  }

  /**
   * Update activity timestamp
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
    const session = this.sessions.get(sessionId);
    if (session?.ffmpegProcess) {
      try {
        session.ffmpegProcess.kill('SIGKILL');
      } catch (error) {
        // Ignore errors when killing process
      }
    }
    return this.sessions.delete(sessionId);
  }

  /**
   * Clean up stale sessions (lazy cleanup)
   * Removes sessions older than timeout or inactive for extended period
   */
  cleanupStaleSessions(): number {
    const now = Date.now();
    const staleThreshold = now - this.sessionTimeout;
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const lastActivityTime = session.lastActivity.getTime();

      // Remove if stale (older than timeout)
      if (lastActivityTime < staleThreshold) {
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

