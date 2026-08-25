import { streamMonitorService } from './stream-monitor-service';
import type { StreamSession, ProgramInfo } from './stream-monitor-service';
import { ChildProcess, spawn } from 'child_process';
import { PassThrough } from 'stream';
import { PlexAPI } from './plex';
import { TimingService } from './timing-service';
import { prisma } from './prisma';
import { loadLiveProgramForChannel } from './resolve-live-program';

export type ErrorType = 'transient' | 'program-related' | 'permanent';

export interface RecoveryOptions {
  streamUrl: string;
  seekSeconds: number;
  channelNumber: number;
  programInfo: ProgramInfo;
  passthrough: PassThrough;
  forceSoftware?: boolean;
}

export interface RecoveryResult {
  success: boolean;
  error?: string;
  process?: ChildProcess;
}

export class StreamRecoveryService {
  private static instance: StreamRecoveryService;
  private circuitBreakers: Map<number, { failures: number; openedAt: Date }> = new Map();
  private activeRecoveries: Set<string> = new Set();
  
  // Configuration from environment
  private maxAttempts: number;
  private backoffBase: number;
  private backoffMax: number;
  private circuitBreakerThreshold: number;
  private circuitBreakerResetMs: number;
  private maxConcurrentRecoveries: number;

  private constructor() {
    this.maxAttempts = parseInt(
      process.env.STREAM_RECOVERY_MAX_ATTEMPTS || '3',
      10
    );
    this.backoffBase = parseInt(
      process.env.STREAM_RECOVERY_BACKOFF_BASE || '2000',
      10
    );
    this.backoffMax = parseInt(
      process.env.STREAM_RECOVERY_BACKOFF_MAX || '30000',
      10
    );
    this.circuitBreakerThreshold = parseInt(
      process.env.STREAM_CIRCUIT_BREAKER_THRESHOLD || '3',
      10
    );
    this.circuitBreakerResetMs = parseInt(
      process.env.STREAM_CIRCUIT_BREAKER_RESET_MS || '300000',
      10
    );
    this.maxConcurrentRecoveries = parseInt(
      process.env.STREAM_MAX_CONCURRENT_RECOVERIES || '5',
      10
    );
  }

  static getInstance(): StreamRecoveryService {
    if (!StreamRecoveryService.instance) {
      StreamRecoveryService.instance = new StreamRecoveryService();
    }
    return StreamRecoveryService.instance;
  }

  /**
   * Classify error type to determine recovery strategy
   */
  classifyError(error: string): ErrorType {
    const errorLower = error.toLowerCase();

    // Permanent errors - don't retry
    if (
      errorLower.includes('not found') ||
      errorLower.includes('missing') ||
      errorLower.includes('invalid token') ||
      errorLower.includes('unauthorized') ||
      errorLower.includes('forbidden') ||
      errorLower.includes('does not exist')
    ) {
      return 'permanent';
    }

    // Program-related errors - refresh program info
    if (
      errorLower.includes('program has ended') ||
      errorLower.includes('program ended') ||
      errorLower.includes('timing') ||
      errorLower.includes('seek offset')
    ) {
      return 'program-related';
    }

    // Transient errors - retry with backoff
    return 'transient';
  }

  /**
   * Check if circuit breaker is open for a channel
   */
  isCircuitOpen(channelNumber: number): boolean {
    const breaker = this.circuitBreakers.get(channelNumber);
    if (!breaker) {
      return false;
    }

    // Check if circuit should reset
    const now = Date.now();
    if (now - breaker.openedAt.getTime() > this.circuitBreakerResetMs) {
      this.circuitBreakers.delete(channelNumber);
      return false;
    }

    return breaker.failures >= this.circuitBreakerThreshold;
  }

  /**
   * Record a failure for circuit breaker
   */
  recordFailure(channelNumber: number): void {
    const breaker = this.circuitBreakers.get(channelNumber);
    if (breaker) {
      breaker.failures++;
      breaker.openedAt = new Date();
    } else {
      this.circuitBreakers.set(channelNumber, {
        failures: 1,
        openedAt: new Date(),
      });
    }
  }

  /**
   * Reset circuit breaker for a channel (on success)
   */
  resetCircuitBreaker(channelNumber: number): void {
    this.circuitBreakers.delete(channelNumber);
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  calculateBackoff(attempt: number): number {
    const baseDelay = Math.min(
      this.backoffBase * Math.pow(2, attempt - 1),
      this.backoffMax
    );
    // Add jitter (±20%)
    const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, baseDelay + jitter);
  }

  /**
   * Check if recovery can proceed (circuit breaker and limits)
   */
  canRecover(sessionId: string, channelNumber: number): {
    canRecover: boolean;
    reason?: string;
  } {
    // Check circuit breaker
    if (this.isCircuitOpen(channelNumber)) {
      return {
        canRecover: false,
        reason: 'Circuit breaker is open',
      };
    }

    // Check concurrent recovery limit
    if (this.activeRecoveries.size >= this.maxConcurrentRecoveries) {
      return {
        canRecover: false,
        reason: 'Maximum concurrent recoveries reached',
      };
    }

    // Check if already recovering
    if (this.activeRecoveries.has(sessionId)) {
      return {
        canRecover: false,
        reason: 'Recovery already in progress',
      };
    }

    const session = streamMonitorService.getSession(sessionId);
    if (!session) {
      return {
        canRecover: false,
        reason: 'Session not found',
      };
    }

    // Check recovery attempt limits
    if (session.recoveryAttempts >= this.maxAttempts) {
      return {
        canRecover: false,
        reason: 'Maximum recovery attempts exceeded',
      };
    }

    // Check if session is stale (client disconnected > 2 minutes)
    const now = Date.now();
    const lastActivity = session.lastActivity.getTime();
    if (now - lastActivity > 120000) {
      return {
        canRecover: false,
        reason: 'Session is stale',
      };
    }

    return { canRecover: true };
  }

  /**
   * Refresh program info for program-related errors
   */
  async refreshProgramInfo(channelNumber: number): Promise<{
    programInfo: ProgramInfo;
    streamUrl: string;
    seekSeconds: number;
  } | null> {
    try {
      const live = await loadLiveProgramForChannel(channelNumber);
      if (!live) {
        return null;
      }
      return {
        programInfo: live.programInfo,
        streamUrl: live.streamUrl,
        seekSeconds: live.seekSeconds,
      };
    } catch (error) {
      console.error(`[Recovery] Failed to refresh program info for channel ${channelNumber}:`, error);
      return null;
    }
  }

  /**
   * Attempt to recover a stream session
   */
  async attemptRecovery(
    sessionId: string,
    error: string,
    buildFfmpegArgs: (streamUrl: string, seekSeconds: number, options?: { forceSoftware?: boolean; discontinuity?: boolean }) => Promise<string[]>
  ): Promise<RecoveryResult> {
    const session = streamMonitorService.getSession(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    // Check if recovery can proceed
    const canRecover = this.canRecover(sessionId, session.channelNumber);
    if (!canRecover.canRecover) {
      return { success: false, error: canRecover.reason };
    }

    // Classify error
    const errorType = this.classifyError(error);

    // Handle permanent errors - fail fast
    if (errorType === 'permanent') {
      streamMonitorService.updateStatus(sessionId, 'failed');
      this.recordFailure(session.channelNumber);
      return { success: false, error: 'Permanent error, cannot recover' };
    }

    // Mark recovery as in progress
    this.activeRecoveries.add(sessionId);
    streamMonitorService.updateStatus(sessionId, 'recovering');
    streamMonitorService.incrementRecoveryAttempts(sessionId);

    try {
      // Handle program-related errors - refresh program info
      if (errorType === 'program-related') {
        const refreshed = await this.refreshProgramInfo(session.channelNumber);
        if (!refreshed) {
          streamMonitorService.updateStatus(sessionId, 'failed');
          this.recordFailure(session.channelNumber);
          return { success: false, error: 'Failed to refresh program info' };
        }

        // Update session metadata
        streamMonitorService.updateSessionMetadata(sessionId, {
          programInfo: refreshed.programInfo,
          streamUrl: refreshed.streamUrl,
          seekSeconds: refreshed.seekSeconds,
        });
      }

      // Calculate backoff delay for transient errors
      if (errorType === 'transient') {
        const delay = this.calculateBackoff(session.recoveryAttempts);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Determine if we should force software encoding
      const forceSoftware = session.restartedToSoftware || session.recoveryAttempts >= 2;

      // Build FFmpeg args
      const streamUrl = session.streamUrl || '';
      const seekSeconds = session.seekSeconds || 0;
      const ffmpegArgs = await buildFfmpegArgs(streamUrl, seekSeconds, {
        forceSoftware,
        // Replacement encoder is a new MPEG-TS timeline — players need PAT/PMT.
        discontinuity: true,
      });

      // Spawn new FFmpeg process
      console.log(`[Recovery] Attempting recovery for session ${sessionId} (attempt ${session.recoveryAttempts})`);
      const child = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      // Update session with new process
      streamMonitorService.setFfmpegProcess(sessionId, child);
      if (forceSoftware) {
        streamMonitorService.updateSessionMetadata(sessionId, {
          restartedToSoftware: true,
        });
      }

      // Reset recovery attempts on successful spawn
      streamMonitorService.resetRecoveryAttempts(sessionId);
      streamMonitorService.updateStatus(sessionId, 'active');
      this.resetCircuitBreaker(session.channelNumber);

      return { success: true, process: child };
    } catch (recoveryError: any) {
      console.error(`[Recovery] Recovery attempt failed for session ${sessionId}:`, recoveryError);
      this.recordFailure(session.channelNumber);

      // Check if we've exceeded attempts
      if (session.recoveryAttempts >= this.maxAttempts) {
        streamMonitorService.updateStatus(sessionId, 'failed');
        return {
          success: false,
          error: `Recovery failed after ${this.maxAttempts} attempts`,
        };
      }

      return { success: false, error: recoveryError.message };
    } finally {
      this.activeRecoveries.delete(sessionId);
    }
  }

  /**
   * Clean up recovery state for a session
   */
  cleanup(sessionId: string): void {
    this.activeRecoveries.delete(sessionId);
  }

  /** Drop circuit breaker entries that have not been updated recently. */
  evictStaleCircuitBreakers(
    maxAgeMs: number = 24 * 60 * 60 * 1000,
    now: number = Date.now(),
  ): void {
    for (const [channelNumber, state] of this.circuitBreakers.entries()) {
      if (now - state.openedAt.getTime() > maxAgeMs) {
        this.circuitBreakers.delete(channelNumber);
      }
    }
  }
}

export const streamRecoveryService = StreamRecoveryService.getInstance();

