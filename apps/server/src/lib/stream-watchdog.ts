import { streamMonitorService } from './stream-monitor-service';
import { streamHealthMonitor } from './stream-health-monitor';

export class StreamWatchdog {
  private static instance: StreamWatchdog;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private constructor() {}

  static getInstance(): StreamWatchdog {
    if (!StreamWatchdog.instance) {
      StreamWatchdog.instance = new StreamWatchdog();
    }
    return StreamWatchdog.instance;
  }

  /**
   * Start the watchdog service
   */
  start(): void {
    if (this.isRunning) {
      console.log('[StreamWatchdog] Already running');
      return;
    }

    console.log('[StreamWatchdog] Starting stream watchdog service');
    this.isRunning = true;

    // Perform initial health check
    this.performHealthCheck();

    // Schedule periodic health checks with adaptive interval
    this.scheduleNextCheck();
  }

  /**
   * Schedule the next health check based on adaptive interval
   */
  private scheduleNextCheck(): void {
    if (!this.isRunning) {
      return;
    }

    // Clear existing interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    // Get adaptive interval based on active stream count
    const interval = streamHealthMonitor.getHealthCheckInterval();

    this.intervalId = setInterval(() => {
      this.performHealthCheck();
      // Reschedule with updated interval (may have changed based on stream count)
      this.scheduleNextCheck();
    }, interval);

    console.log(`[StreamWatchdog] Scheduled next health check in ${interval}ms`);
  }

  /**
   * Perform health check and trigger recovery if needed
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // Clean up stale sessions first
      const cleaned = streamMonitorService.cleanupStaleSessions();
      if (cleaned > 0) {
        console.log(`[StreamWatchdog] Cleaned up ${cleaned} stale sessions`);
      }

      // Perform health checks on all active sessions
      const healthResults = await streamHealthMonitor.performHealthChecks();

      if (healthResults.checked > 0) {
        console.log(
          `[StreamWatchdog] Health check: ${healthResults.checked} checked, ` +
          `${healthResults.unhealthy} unhealthy, ${healthResults.recovered} recovered`
        );
      }

      // Note: Actual recovery happens in video route via event handlers
      // Watchdog focuses on detection and cleanup of stale sessions
    } catch (error) {
      console.error('[StreamWatchdog] Error during health check:', error);
    }
  }


  /**
   * Stop the watchdog service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[StreamWatchdog] Stream watchdog service stopped');
  }

  /**
   * Restart the watchdog service
   */
  restart(): void {
    this.stop();
    this.start();
  }

  /**
   * Get current status
   */
  getStatus(): { isRunning: boolean; activeSessions: number } {
    return {
      isRunning: this.isRunning,
      activeSessions: streamMonitorService.getActiveSessionCount(),
    };
  }
}

export const streamWatchdog = StreamWatchdog.getInstance();

