import { programmingService } from './programming-service';
import { prisma } from './prisma';

export class StartupService {
  private static initialized = false;
  private static initializationPromise: Promise<void> | null = null;
  private static syncIntervals: Map<string, NodeJS.Timeout> = new Map();

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
    console.log('🚀 Initializing TwentyFour/Seven server...');
    
    try {
      // Check if we have any programs
      const programCount = await prisma.program.count();
      
      if (programCount === 0) {
        console.log('📺 No programs found, generating initial programming...');
        await programmingService.generateProgramsForAllChannels(); // Use guideDays setting
        console.log('✅ Initial programming generated');
      } else {
        console.log(`📺 Found ${programCount} existing programs`);
        // No automatic maintenance or regeneration here
        // await programmingService.maintainPrograms();
        // console.log('✅ Programming maintained');
      }

      // Initialize automatic Plex library sync
      await this.initializeAutomaticPlexSync();

      console.log('✅ TwentyFour/Seven server initialized successfully');
    } catch (error) {
      console.error('❌ Error during server initialization:', error);
      throw error;
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
        console.log('📡 Automatic Plex sync is disabled');
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
        console.log(`📡 Scheduled automatic sync for ${plexServers.length} Plex servers`);
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
        console.log(`🔄 Starting automatic Plex sync for server ${serverId}`);
        const { PlexService } = await import('./plex-service');
        await PlexService.syncLibraries(serverId);
        console.log(`✅ Completed automatic Plex sync for server ${serverId}`);
      } catch (error) {
        console.error(`❌ Error during automatic Plex sync for server ${serverId}:`, error);
      }
    }, intervalMs);

    this.syncIntervals.set(serverId, interval);
    console.log(`📅 Scheduled Plex server ${serverId} to sync every ${intervalHours} hours`);
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
        console.log(`🚫 Disabled automatic sync for Plex server ${serverId}`);
      }
    }
  }

  /**
   * Cleanup on shutdown
   */
  static cleanup() {
    for (const [serverId, interval] of this.syncIntervals) {
      clearInterval(interval);
      console.log(`🧹 Cleaned up sync interval for server ${serverId}`);
    }
    this.syncIntervals.clear();
  }
}

export const startupService = new StartupService(); 