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
    
    console.log(`📅 Scheduling WatchTower sync every ${settings.watchTowerSyncInterval} hours`);

    this.watchTowerInterval = setInterval(async () => {
      try {
        console.log("🔄 Starting scheduled WatchTower sync...");
        const results = await watchTowerService.syncUsers();
        console.log(`✅ WatchTower sync completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`);
      } catch (error) {
        console.error("❌ Scheduled WatchTower sync failed:", error);
      }
    }, intervalMs);
  }

  stopWatchTowerSync() {
    if (this.watchTowerInterval) {
      clearInterval(this.watchTowerInterval);
      this.watchTowerInterval = null;
      console.log("⏹️ WatchTower sync scheduler stopped");
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

    console.log("📅 Starting automatic programming maintenance...");

    // Run immediately on startup
    try {
      await programmingService.maintainPrograms();
      console.log("✅ Initial programming maintenance completed");
    } catch (error) {
      console.error("❌ Initial programming maintenance failed:", error);
    }

    // Schedule to run every hour
    this.programmingMaintenanceInterval = setInterval(async () => {
      try {
        console.log("🔄 Running scheduled programming maintenance...");
        await programmingService.maintainPrograms();
        
        // Also cleanup old programs to prevent database bloat
        await programmingService.cleanupOldPrograms();
        
        console.log("✅ Programming maintenance completed");
      } catch (error) {
        console.error("❌ Programming maintenance failed:", error);
      }
    }, 60 * 60 * 1000); // Run every hour

    console.log("📅 Scheduled programming maintenance to run every hour");
  }

  /**
   * Start periodic channel automation sweep to catch missed events and bulk metadata changes
   * Default cadence: every 15 minutes
   */
  async startChannelAutomationSweep() {
    if (this.automationInterval) {
      clearInterval(this.automationInterval);
    }

    console.log("📅 Starting periodic channel automation sweep...");

    // Run once on startup
    try {
      const { channelAutomationService } = await import('./channel-automation-service');
      await channelAutomationService.processAutomatedChannels();
      console.log("✅ Initial automation sweep completed");
    } catch (error) {
      console.error("❌ Initial automation sweep failed:", error);
    }

    this.automationInterval = setInterval(async () => {
      try {
        console.log("🔄 Running scheduled channel automation sweep...");
        const { channelAutomationService } = await import('./channel-automation-service');
        await channelAutomationService.processAutomatedChannels();
        console.log("✅ Channel automation sweep completed");
      } catch (error) {
        console.error("❌ Channel automation sweep failed:", error);
      }
    }, 15 * 60 * 1000);

    console.log("📅 Scheduled channel automation sweep to run every 15 minutes");
  }

  stopChannelAutomationSweep() {
    if (this.automationInterval) {
      clearInterval(this.automationInterval);
      this.automationInterval = null;
      console.log("⏹️ Channel automation sweep scheduler stopped");
    }
  }

  /**
   * Stop programming maintenance
   */
  stopProgrammingMaintenance() {
    if (this.programmingMaintenanceInterval) {
      clearInterval(this.programmingMaintenanceInterval);
      this.programmingMaintenanceInterval = null;
      console.log("⏹️ Programming maintenance scheduler stopped");
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
   * Stop all scheduled tasks
   */
  stopAll() {
    this.stopWatchTowerSync();
    this.stopProgrammingMaintenance();
    this.stopChannelAutomationSweep();
  }
}

export const scheduler = SchedulerService.getInstance(); 