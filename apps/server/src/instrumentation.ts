export async function register() {
  // This runs once when the server starts up
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('🔧 Server startup: Initializing TwentyFour/Seven...');
    
    // Use dynamic import to avoid loading Prisma-dependent code in Edge Runtime
    const { StartupService } = await import('./lib/startup');
    await StartupService.initialize();
  }
} 