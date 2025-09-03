interface MemoryStats {
  rss: number; // Resident Set Size
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface MemoryThresholds {
  warning: number; // MB
  critical: number; // MB
  maxHeap: number; // MB
}

class MemoryMonitor {
  private static instance: MemoryMonitor;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastGarbageCollection: number = Date.now();
  private memoryHistory: MemoryStats[] = [];
  private readonly maxHistorySize = 100;

  private thresholds: MemoryThresholds = {
    warning: 512, // 512MB warning
    critical: 1024, // 1GB critical
    maxHeap: 2048, // 2GB max heap
  };

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  /**
   * Start memory monitoring
   */
  startMonitoring(intervalMs: number = 60000): void { // Default: check every minute
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    console.log('📊 Starting memory monitoring...');
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('⏹️ Memory monitoring stopped');
    }
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats(): MemoryStats & { uptime: number } {
    const memUsage = process.memoryUsage();
    return {
      rss: Math.round(memUsage.rss / 1024 / 1024), // Convert to MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024),
      uptime: Math.round(process.uptime()),
    };
  }

  /**
   * Check memory usage and take action if needed
   */
  private checkMemoryUsage(): void {
    const stats = this.getMemoryStats();
    this.memoryHistory.push(stats);

    // Keep history size manageable
    if (this.memoryHistory.length > this.maxHistorySize) {
      this.memoryHistory.shift();
    }

    const heapUsedMB = stats.heapUsed;

    // Log memory stats periodically
    if (this.memoryHistory.length % 10 === 0) { // Log every 10 minutes
      console.log(`📊 Memory: RSS=${stats.rss}MB, Heap=${stats.heapUsed}/${stats.heapTotal}MB, Uptime=${stats.uptime}s`);
    }

    // Warning threshold
    if (heapUsedMB >= this.thresholds.warning) {
      console.warn(`⚠️ High memory usage detected: ${heapUsedMB}MB heap used`);

      // Force garbage collection if available and enough time has passed
      if (global.gc && Date.now() - this.lastGarbageCollection > 300000) { // 5 minutes
        console.log('🧹 Running garbage collection...');
        global.gc();
        this.lastGarbageCollection = Date.now();

        // Check memory after GC
        const afterGC = this.getMemoryStats();
        console.log(`🧹 After GC: Heap=${afterGC.heapUsed}MB (saved ${heapUsedMB - afterGC.heapUsed}MB)`);
      }
    }

    // Critical threshold - take aggressive action
    if (heapUsedMB >= this.thresholds.critical) {
      console.error(`🚨 CRITICAL: Memory usage at ${heapUsedMB}MB!`);
      this.performEmergencyCleanup();
    }

    // Max heap threshold - restart recommendation
    if (heapUsedMB >= this.thresholds.maxHeap) {
      console.error(`💥 EXTREME: Memory usage at ${heapUsedMB}MB! Container restart recommended.`);
      // In a production environment, you might want to trigger a restart here
    }
  }

  /**
   * Perform emergency cleanup when memory is critical
   */
  private async performEmergencyCleanup(): Promise<void> {
    console.log('🚨 Performing emergency memory cleanup...');

    try {
      // Clear any cached data
      this.clearCaches();

      // Force garbage collection
      if (global.gc) {
        global.gc();
        global.gc(); // Run twice for better cleanup
      }

      // Log cleanup results
      const afterCleanup = this.getMemoryStats();
      console.log(`🧹 Emergency cleanup complete. Memory: ${afterCleanup.heapUsed}MB heap used`);

    } catch (error) {
      console.error('❌ Error during emergency cleanup:', error);
    }
  }

  /**
   * Clear application caches
   */
  private clearCaches(): void {
    try {
      // Clear FFMPEG service cache
      const { ffmpegService } = require('./ffmpeg-service');
      if (ffmpegService && typeof ffmpegService.clearCache === 'function') {
        ffmpegService.clearCache();
        console.log('🧹 Cleared FFMPEG cache');
      }

      // Add other cache clearing as needed
      // This could include clearing any in-memory caches from other services

    } catch (error) {
      console.warn('⚠️ Error clearing caches:', error);
    }
  }

  /**
   * Get memory usage trend
   */
  getMemoryTrend(): { trend: 'stable' | 'increasing' | 'decreasing'; average: number; peak: number } {
    if (this.memoryHistory.length < 5) {
      return { trend: 'stable', average: 0, peak: 0 };
    }

    const recent = this.memoryHistory.slice(-10);
    const heapUsage = recent.map(stats => stats.heapUsed);

    const average = heapUsage.reduce((sum, val) => sum + val, 0) / heapUsage.length;
    const peak = Math.max(...heapUsage);

    // Simple trend analysis
    const firstHalf = heapUsage.slice(0, Math.floor(heapUsage.length / 2));
    const secondHalf = heapUsage.slice(Math.floor(heapUsage.length / 2));

    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;

    const difference = secondAvg - firstAvg;
    const trend = Math.abs(difference) < 50 ? 'stable' :
                  difference > 0 ? 'increasing' : 'decreasing';

    return { trend, average: Math.round(average), peak };
  }

  /**
   * Set custom memory thresholds
   */
  setThresholds(thresholds: Partial<MemoryThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    console.log('📊 Memory thresholds updated:', this.thresholds);
  }
}

export const memoryMonitor = MemoryMonitor.getInstance();

// Auto-start monitoring if this module is imported
if (typeof process !== 'undefined') {
  // Start monitoring after a short delay to allow the app to initialize
  setTimeout(() => {
    memoryMonitor.startMonitoring();
  }, 30000); // Start monitoring after 30 seconds
}
