import { programmingService } from './programming-service';
import { prisma } from './prisma';

export class StartupService {
  private static initialized = false;
  private static initializationPromise: Promise<void> | null = null;

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

      // Remove periodic maintenance
      // setInterval(async () => {
      //   try {
      //     console.log('🔄 Running periodic program maintenance...');
      //     await programmingService.maintainPrograms();
      //     await programmingService.cleanupOldPrograms();
      //     console.log('✅ Periodic maintenance completed');
      //   } catch (error) {
      //     console.error('❌ Error during periodic maintenance:', error);
      //   }
      // }, 6 * 60 * 60 * 1000); // 6 hours

      console.log('✅ TwentyFour/Seven server initialized successfully');
    } catch (error) {
      console.error('❌ Error during server initialization:', error);
      throw error;
    }
  }
}

export const startupService = new StartupService(); 