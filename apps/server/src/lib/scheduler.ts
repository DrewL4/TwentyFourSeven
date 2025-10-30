import { WatchTowerService } from "./watchtower-service";
import { programmingService } from "./programming-service";

class SchedulerService {
  private static instance: SchedulerService;
  private watchTowerInterval: ReturnType<typeof setInterval> | null = null;
  private programmingMaintenanceInterval: ReturnType<typeof setInterval> | null = null;
  private automationInterval: ReturnType<typeof setInterval> | null = null;

  public static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  async startWatchTowerSync() {
    // Clear existing interval if any
    if (this.watchTowerInterval) {
      clearInterval(this.watchTowerInterval);
    }

          const watchTowerService = WatchTowerService.getInstance();
    const settings = await watchTowerService.getSettings();

    if (!settings || !settings.watchTowerAutoSync) {
      console.log("WatchTower auto-sync is disabled");
      return;
    }

    const intervalMs = settings.watchTowerSyncInterval * 60 * 60 * 1000; // Convert hours to milliseconds
    

    this.watchTowerInterval = setInterval(async () => {
      try {
        const results = await watchTowerService.syncUsers();
      } catch (error) {
        console.error("❌ Scheduled WatchTower sync failed:", error);
      }
    }, intervalMs);
  }

  stopWatchTowerSync() {
    if (this.watchTowerInterval) {
      clearInterval(this.watchTowerInterval);
      this.watchTowerInterval = null;
    }
  }

  async restartWatchTowerSync() {
    this.stopWatchTowerSync();
    await this.startWatchTowerSync();
  }

  /**
   * Start automatic programming maintenance to ensure channels never end
   * This runs every hour to check and extend programming as needed
   */
  async startProgrammingMaintenance() {
    // Clear existing interval if any
    if (this.programmingMaintenanceInterval) {
      clearInterval(this.programmingMaintenanceInterval);
    }


    // Run immediately on startup
    try {
      await programmingService.maintainPrograms();
    } catch (error) {
      console.error("❌ Initial programming maintenance failed:", error);
    }

    // Schedule to run every hour
    this.programmingMaintenanceInterval = setInterval(async () => {
      try {
        await programmingService.maintainPrograms();
        
        // Also cleanup old programs to prevent database bloat
        await programmingService.cleanupOldPrograms();
        
      } catch (error) {
        console.error("❌ Programming maintenance failed:", error);
      }
    }, 60 * 60 * 1000); // Run every hour

  }

  /**
   * Start periodic channel automation sweep to catch missed events and bulk metadata changes
   * Default cadence: every 15 minutes
   */
  async startChannelAutomationSweep() {
    if (this.automationInterval) {
      clearInterval(this.automationInterval);
    }


    // Run once on startup
    try {
      const { channelAutomationService } = await import('./channel-automation-service');
      await channelAutomationService.processAutomatedChannels();
    } catch (error) {
      console.error("❌ Initial automation sweep failed:", error);
    }

    this.automationInterval = setInterval(async () => {
      try {
        const { channelAutomationService } = await import('./channel-automation-service');
        await channelAutomationService.processAutomatedChannels();
      } catch (error) {
        console.error("❌ Channel automation sweep failed:", error);
      }
    }, 15 * 60 * 1000);

  }

  stopChannelAutomationSweep() {
    if (this.automationInterval) {
      clearInterval(this.automationInterval);
      this.automationInterval = null;
    }
  }

  /**
   * Stop programming maintenance
   */
  stopProgrammingMaintenance() {
    if (this.programmingMaintenanceInterval) {
      clearInterval(this.programmingMaintenanceInterval);
      this.programmingMaintenanceInterval = null;
    }
  }

  /**
   * Restart programming maintenance
   */
  async restartProgrammingMaintenance() {
    this.stopProgrammingMaintenance();
    await this.startProgrammingMaintenance();
  }

  /**
   * Start stream watchdog for monitoring and auto-recovery
   */
  async startStreamWatchdog() {
    try {
      const { streamWatchdog } = await import('./stream-watchdog');
      streamWatchdog.start();
    } catch (error) {
      console.error('❌ Failed to start stream watchdog:', error);
    }
  }

  /**
   * Stop stream watchdog
   */
  stopStreamWatchdog() {
    try {
      const { streamWatchdog } = require('./stream-watchdog');
      streamWatchdog.stop();
    } catch (error) {
      console.error('❌ Failed to stop stream watchdog:', error);
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stopAll() {
    this.stopWatchTowerSync();
    this.stopProgrammingMaintenance();
    this.stopChannelAutomationSweep();
    this.stopStreamWatchdog();
  }
}

export const scheduler = SchedulerService.getInstance(); 