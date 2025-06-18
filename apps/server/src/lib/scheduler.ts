import { WatchTowerService } from "./watchtower-service";

class SchedulerService {
  private static instance: SchedulerService;
  private watchTowerInterval: NodeJS.Timeout | null = null;

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
}

export const scheduler = SchedulerService.getInstance(); 