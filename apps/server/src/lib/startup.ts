import { programmingService } from './programming-service';
import { prisma } from './prisma';
import { scheduler } from './scheduler';

export class StartupService {
  private static initialized = false;
  private static initializationPromise: Promise<void> | null = null;
  private static syncIntervals: Map<string, NodeJS.Timeout> = new Map();
  private static integrationStreamInterval: NodeJS.Timeout | null = null;

  static async initialize() {
    // If already initialized, return immediately
    if (this.initialized) return;
    
    // If initialization is in progress, wait for it to complete
    if (this.initializationPromise) {
      return await this.initializationPromise;
    }

    // Set the flag immediately to prevent race conditions
    this.initializationPromise = this._doInitialization();
    
    try {
      await this.initializationPromise;
      this.initialized = true;
    } catch (error) {
      // Reset on error so we can try again
      this.initializationPromise = null;
      throw error;
    }
  }

  private static async _doInitialization() {
    
    try {
      // Check if we have any programs
      const programCount = await prisma.program.count();
      
      if (programCount === 0) {
        await programmingService.generateProgramsForAllChannels(); // Use guideDays setting
      } else {
        // No automatic maintenance or regeneration here
        // await programmingService.maintainPrograms();
      }

      // Initialize automatic Plex library sync
      await this.initializeAutomaticPlexSync();

      // Initialize WatchTower sync scheduler
      await this.initializeWatchTowerSync();

      // Optional Redis integration stream consumer (hub-managed)
      await this.initializeIntegrationStreamConsumer();

      // Initialize programming maintenance to ensure channels never end
      await this.initializeProgrammingMaintenance();

      // Initialize periodic channel automation sweep
      await this.initializeChannelAutomation();

      // Sync built-in franchise watch orders (MCU, Star Wars) from remote + TMDB
      await this.initializeFranchiseSync();

      // Initialize stream watchdog for monitoring and auto-recovery
      await this.initializeStreamWatchdog();

    } catch (error) {
      console.error('❌ Error during server initialization:', error);
      throw error;
    }
  }

  /**
   * Initialize WatchTower sync scheduler
   */
  private static async initializeWatchTowerSync() {
    try {
      await scheduler.startWatchTowerSync();
    } catch (error) {
      console.error('❌ Error initializing WatchTower sync:', error);
    }
  }

  private static async initializeIntegrationStreamConsumer() {
    try {
      const { consumeIntegrationStream } = await import('./integration-stream-consumer');
      const tick = async () => {
        try {
          await consumeIntegrationStream();
        } catch (error) {
          console.debug('Integration stream tick skipped:', error);
        }
      };
      await tick();
      if (this.integrationStreamInterval) {
        clearInterval(this.integrationStreamInterval);
      }
      this.integrationStreamInterval = setInterval(tick, 5000);
    } catch (error) {
      console.debug('Integration stream consumer not started:', error);
    }
  }

  /**
   * Initialize automatic Plex library synchronization
   */
  private static async initializeAutomaticPlexSync() {
    try {
      // Get Plex settings to check if auto-refresh is enabled
      const plexSettings = await prisma.plexSettings.findFirst();
      
      if (!plexSettings?.autoRefreshLibraries) {
        return;
      }

      // Get all active Plex servers
      const plexServers = await prisma.mediaServer.findMany({
        where: {
          type: 'PLEX',
          active: true
        },
        include: {
          libraries: true
        }
      });

      for (const server of plexServers) {
        this.scheduleServerSync(server.id, plexSettings.refreshInterval);
      }

      if (plexServers.length > 0) {
      }
    } catch (error) {
      console.error('❌ Error initializing automatic Plex sync:', error);
    }
  }

  /**
   * Schedule automatic sync for a specific Plex server
   */
  private static scheduleServerSync(serverId: string, intervalHours: number) {
    // Clear existing interval if any
    const existingInterval = this.syncIntervals.get(serverId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Convert hours to milliseconds
    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Schedule recurring sync
    const interval = setInterval(async () => {
      try {
        const { PlexService } = await import('./plex-service');
        await PlexService.syncLibraries(serverId);
      } catch (error) {
        console.error(`❌ Error during automatic Plex sync for server ${serverId}:`, error);
      }
    }, intervalMs);

    this.syncIntervals.set(serverId, interval);
  }

  /**
   * Update sync schedule for a server (called when settings change)
   */
  static updateServerSyncSchedule(serverId: string, enabled: boolean, intervalHours: number) {
    if (enabled) {
      this.scheduleServerSync(serverId, intervalHours);
    } else {
      const existingInterval = this.syncIntervals.get(serverId);
      if (existingInterval) {
        clearInterval(existingInterval);
        this.syncIntervals.delete(serverId);
      }
    }
  }

  /**
   * Initialize programming maintenance to ensure channels never end
   */
  private static async initializeProgrammingMaintenance() {
    try {
      await scheduler.startProgrammingMaintenance();
    } catch (error) {
      console.error('❌ Error initializing programming maintenance:', error);
    }
  }

  /**
   * Initialize periodic channel automation sweep
   */
  private static async initializeChannelAutomation() {
    try {
      await scheduler.startChannelAutomationSweep();
    } catch (error) {
      console.error('❌ Error initializing channel automation:', error);
    }
  }

  private static async initializeFranchiseSync() {
    try {
      await scheduler.startFranchiseSync();
    } catch (error) {
      console.error('❌ Error initializing franchise sync:', error);
    }
  }

  /**
   * Initialize stream watchdog for monitoring and auto-recovery
   */
  private static async initializeStreamWatchdog() {
    try {
      await scheduler.startStreamWatchdog();
    } catch (error) {
      console.error('❌ Error initializing stream watchdog:', error);
    }
  }

  /**
   * Cleanup on shutdown
   */
  static cleanup() {
    for (const [serverId, interval] of this.syncIntervals) {
      clearInterval(interval);
    }
    this.syncIntervals.clear();

    if (this.integrationStreamInterval) {
      clearInterval(this.integrationStreamInterval);
      this.integrationStreamInterval = null;
    }
    
    // Cleanup all scheduled tasks
    scheduler.stopAll();
  }
}

export const startupService = new StartupService(); 