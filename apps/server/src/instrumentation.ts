export async function register() {
  // This runs once when the server starts up
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    
    // Use dynamic import to avoid loading Prisma-dependent code in Edge Runtime
    const { StartupService } = await import('./lib/startup');
    await StartupService.initialize();
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      StartupService.cleanup();
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      StartupService.cleanup();
      process.exit(0);
    });
  }
} 