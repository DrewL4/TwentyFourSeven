export async function register() {
  // This runs once when the server starts up
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('🔧 Server startup: Initializing TwentyFour/Seven...');

    // Use dynamic import to avoid loading Prisma-dependent code in Edge Runtime
    const { StartupService } = await import('./lib/startup');
    await StartupService.initialize();

    // Start memory monitoring
    const { memoryMonitor } = await import('./lib/memory-monitor');
    memoryMonitor.startMonitoring();

    // Comprehensive graceful shutdown handler
    const gracefulShutdown = async (signal: string) => {
      console.log(`🛑 ${signal} received, performing comprehensive cleanup...`);

      try {
        // Clean up startup service resources (intervals, etc.)
        StartupService.cleanup();

        // Clean up Prisma connections
        const { disconnectPrisma } = await import('./lib/prisma');
        await disconnectPrisma();

        // Stop memory monitoring
        const { memoryMonitor } = await import('./lib/memory-monitor');
        memoryMonitor.stopMonitoring();

        console.log('✅ All resources cleaned up successfully');
      } catch (error) {
        console.error('❌ Error during cleanup:', error);
      } finally {
        process.exit(0);
      }
    };

    // Handle multiple shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });

    // Handle process warnings (optional but good for monitoring)
    process.on('warning', (warning) => {
      console.warn('⚠️ Process Warning:', warning.name, warning.message);
    });
  }
} 