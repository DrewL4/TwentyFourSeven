export async function register() {
  // This runs once when the server starts up
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    
    // Use dynamic import to avoid loading Prisma-dependent code in Edge Runtime
    // Probe FFmpeg in the background so the first play doesn't wait on it.
    const { warmFfmpegCapabilities, warmFfmpegToneMap } = await import('./lib/ffmpeg-capabilities');
    void warmFfmpegCapabilities();
    void warmFfmpegToneMap();
    const { initSqlitePragmas } = await import('./lib/prisma');
    await initSqlitePragmas();
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