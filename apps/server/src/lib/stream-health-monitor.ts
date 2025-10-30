import { streamMonitorService } from './stream-monitor-service';
import { streamRecoveryService } from './stream-recovery-service';

export class StreamHealthMonitor {
  private static instance: StreamHealthMonitor;
  private programInfoCache: Map<
    number,
    { data: any; timestamp: number }
  > = new Map();
  private cacheTTL: number;

  private constructor() {
    // Default cache TTL: 5 seconds
    this.cacheTTL = parseInt(
      process.env.STREAM_PROGRAM_INFO_CACHE_TTL || '5000',
      10
    );
  }

  static getInstance(): StreamHealthMonitor {
    if (!StreamHealthMonitor.instance) {
      StreamHealthMonitor.instance = new StreamHealthMonitor();
    }
    return StreamHealthMonitor.instance;
  }

  /**
   * Calculate adaptive health check interval based on active stream count
   */
  getHealthCheckInterval(): number {
    const activeCount = streamMonitorService.getActiveSessionCount();
    const baseInterval = parseInt(
      process.env.STREAM_HEALTH_CHECK_INTERVAL || '30000',
      10
    );

    if (activeCount < 10) {
      return baseInterval; // 30 seconds
    } else if (activeCount < 50) {
      return baseInterval * 2; // 60 seconds
    } else {
      return baseInterval * 3; // 90 seconds
    }
  }

  /**
   * Check if FFmpeg process is still running (lightweight check)
   */
  isProcessRunning(pid: number | null): boolean {
    if (!pid) {
      return false;
    }

    try {
      // Signal 0 - no-op signal, just checks if process exists (zero overhead)
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // Process doesn't exist or permission denied
      return false;
    }
  }

  /**
   * Check if stream is stalled (no output for threshold period)
   */
  isStreamStalled(lastOutputTimestamp: Date): boolean {
    const stalledThreshold = parseInt(
      process.env.STREAM_STALLED_THRESHOLD || '90000',
      10
    );
    const now = Date.now();
    const lastOutput = lastOutputTimestamp.getTime();
    return now - lastOutput > stalledThreshold;
  }

  /**
   * Get cached program info or fetch fresh
   */
  async getCachedProgramInfo(channelNumber: number): Promise<any | null> {
    const cached = this.programInfoCache.get(channelNumber);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    // Fetch fresh program info
    try {
      const { prisma } = await import('./prisma');
      const { TimingService } = await import('./timing-service');
      const nowDate = new Date();

      const channel = await prisma.channel.findUnique({
        where: { number: channelNumber },
        include: {
          programs: {
            where: { startTime: { lte: nowDate } },
            include: {
              episode: { include: { show: { include: { library: { include: { server: true } } } } } },
              movie: { include: { library: { include: { server: true } } } },
            },
            orderBy: { startTime: 'desc' },
            take: 1,
          },
        },
      });

      if (!channel || channel.programs.length === 0) {
        return null;
      }

      const currentProgram = channel.programs[0];
      const programEnd = new Date(
        currentProgram.startTime.getTime() + currentProgram.duration
      );

      if (nowDate > programEnd) {
        return null; // Program has ended
      }

      const timing = TimingService.calculateSeekOffset(
        currentProgram.startTime,
        currentProgram.duration,
        nowDate
      );
      const programInfo = currentProgram.movie ?? currentProgram.episode;
      const server =
        currentProgram.movie?.library.server ??
        currentProgram.episode?.show.library.server;

      if (!programInfo || !server || server.type !== 'PLEX' || !server.token) {
        return null;
      }

      const programData = {
        programInfo: { ratingKey: programInfo.ratingKey },
        server,
        timing,
      };

      // Cache the result
      this.programInfoCache.set(channelNumber, {
        data: programData,
        timestamp: now,
      });

      return programData;
    } catch (error) {
      console.error(
        `[HealthMonitor] Failed to fetch program info for channel ${channelNumber}:`,
        error
      );
      return null;
    }
  }

  /**
   * Check if program is still valid (hasn't ended)
   */
  async isProgramValid(channelNumber: number): Promise<boolean> {
    const programData = await this.getCachedProgramInfo(channelNumber);
    return programData !== null;
  }

  /**
   * Perform health check on a single session
   */
  async checkSessionHealth(sessionId: string): Promise<{
    healthy: boolean;
    issues: string[];
  }> {
    const session = streamMonitorService.getSession(sessionId);
    if (!session) {
      return { healthy: false, issues: ['Session not found'] };
    }

    // Fail-fast: if session is stale or disconnected, skip check
    const now = Date.now();
    const lastActivity = session.lastActivity.getTime();
    if (now - lastActivity > 120000) {
      // 2 minutes
      return { healthy: false, issues: ['Session is stale'] };
    }

    const issues: string[] = [];

    // Check if FFmpeg process is running
    if (session.ffmpegPid && !this.isProcessRunning(session.ffmpegPid)) {
      issues.push('FFmpeg process is not running');
    }

    // Check if stream is stalled
    if (this.isStreamStalled(session.lastOutputTimestamp)) {
      issues.push('Stream output is stalled');
    }

    // Check if program is still valid (cached check for performance)
    const programValid = await this.isProgramValid(session.channelNumber);
    if (!programValid) {
      issues.push('Program has ended or is invalid');
    }

    return {
      healthy: issues.length === 0,
      issues,
    };
  }

  /**
   * Perform health checks on all active sessions
   */
  async performHealthChecks(): Promise<{
    checked: number;
    unhealthy: number;
    recovered: number;
  }> {
    const activeSessions = streamMonitorService.getActiveSessions();
    let checked = 0;
    let unhealthy = 0;
    let recovered = 0;

    // Batch checks with timeout protection
    const checkPromises = activeSessions.map(async (session) => {
      checked++;
      try {
        // Timeout individual health checks (5 seconds max)
        const healthCheck = await Promise.race([
          this.checkSessionHealth(session.sessionId),
          new Promise<{ healthy: boolean; issues: string[] }>((resolve) =>
            setTimeout(() => resolve({ healthy: true, issues: [] }), 5000)
          ),
        ]);

        if (!healthCheck.healthy) {
          unhealthy++;
          console.warn(
            `[HealthMonitor] Session ${session.sessionId} (channel ${session.channelNumber}) is unhealthy:`,
            healthCheck.issues.join(', ')
          );

          // Trigger recovery if not already recovering
          if (session.status !== 'recovering') {
            const firstIssue = healthCheck.issues[0] || 'Unknown health issue';
            streamMonitorService.addError(session.sessionId, firstIssue);

            // Attempt recovery (will check limits internally)
            // Note: Actual recovery requires FFmpeg args builder, handled by watchdog
            streamMonitorService.updateStatus(session.sessionId, 'recovering');
          }
        } else if (session.status === 'recovering') {
          // Session recovered successfully
          recovered++;
          streamMonitorService.updateStatus(session.sessionId, 'active');
          streamMonitorService.resetRecoveryAttempts(session.sessionId);
        }
      } catch (error) {
        console.error(
          `[HealthMonitor] Error checking session ${session.sessionId}:`,
          error
        );
      }
    });

    await Promise.all(checkPromises);

    return { checked, unhealthy, recovered };
  }

  /**
   * Clear cache (useful for testing or when programs change)
   */
  clearCache(): void {
    this.programInfoCache.clear();
  }

  /**
   * Clear cache for specific channel
   */
  clearChannelCache(channelNumber: number): void {
    this.programInfoCache.delete(channelNumber);
  }
}

export const streamHealthMonitor = StreamHealthMonitor.getInstance();

