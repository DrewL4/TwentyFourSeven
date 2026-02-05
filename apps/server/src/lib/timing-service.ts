/**
 * Minimal types for catchup calculations to avoid importing Prisma in this utility module.
 */
interface CatchupChannel {
  catchupEnabled: boolean;
  catchupWindowHours: number;
}

interface CatchupProgram {
  startTime: Date;
  duration: number;
  catchupAvailable?: boolean;
  catchupExpiry?: Date | null;
}

/**
 * Service for handling program timing calculations
 */
export class TimingService {
  /**
   * Calculate seek offset for a program based on current time
   * Returns the number of milliseconds to seek into the content
   */
  static calculateSeekOffset(programStartTime: Date, programDuration: number, now: Date = new Date()): {
    seekOffsetMs: number;
    isActive: boolean;
    remainingMs: number;
  } {
    const programStart = new Date(programStartTime);
    const programEnd = new Date(programStart.getTime() + programDuration);
    
    // Check if program is currently active
    const isActive = now >= programStart && now <= programEnd;
    
    if (!isActive) {
      return {
        seekOffsetMs: 0,
        isActive: false,
        remainingMs: now < programStart ? programDuration : 0
      };
    }
    
    // Calculate elapsed time since program started
    const seekOffsetMs = now.getTime() - programStart.getTime();
    const remainingMs = programEnd.getTime() - now.getTime();
    
    return {
      seekOffsetMs: Math.max(0, seekOffsetMs),
      isActive: true,
      remainingMs: Math.max(0, remainingMs)
    };
  }
  
  /**
   * Get current program from a list of programs
   */
  static getCurrentProgram<T extends { startTime: Date; duration: number }>(
    programs: T[], 
    now: Date = new Date()
  ): T | null {
    for (const program of programs) {
      const timing = this.calculateSeekOffset(program.startTime, program.duration, now);
      if (timing.isActive) {
        return program;
      }
    }
    return null;
  }
  
  /**
   * Filter programs to only include those that are relevant for the time window
   */
  static filterRelevantPrograms<T extends { startTime: Date; duration: number }>(
    programs: T[],
    windowHoursBefore: number = 1,
    windowHoursAfter: number = 4,
    now: Date = new Date()
  ): T[] {
    const startWindow = new Date(now.getTime() - (windowHoursBefore * 60 * 60 * 1000));
    const endWindow = new Date(now.getTime() + (windowHoursAfter * 60 * 60 * 1000));
    
    return programs.filter(program => {
      const programStart = new Date(program.startTime);
      const programEnd = new Date(programStart.getTime() + program.duration);
      
      // Include if program overlaps with our time window
      return programEnd > startWindow && programStart < endWindow;
    });
  }
  
  /**
   * Calculate the effective duration for a program entry in a playlist
   * (remaining time if currently playing, full duration if future)
   */
  static calculateEffectiveDuration(
    programStartTime: Date,
    programDuration: number,
    now: Date = new Date()
  ): number {
    const timing = this.calculateSeekOffset(programStartTime, programDuration, now);
    
    if (timing.isActive && timing.seekOffsetMs > 0) {
      // Return remaining duration in seconds
      return Math.max(0, Math.floor(timing.remainingMs / 1000));
    }
    
    // Return full duration in seconds
    return Math.floor(programDuration / 1000);
  }
  
  /**
   * Debug timing information for a program (useful for troubleshooting)
   */
  static debugTiming(
    programStartTime: Date,
    programDuration: number,
    programTitle: string = 'Unknown',
    now: Date = new Date()
  ): void {
    const timing = this.calculateSeekOffset(programStartTime, programDuration, now);
    const programStart = new Date(programStartTime);
    const programEnd = new Date(programStart.getTime() + programDuration);
    
    console.log(`[TimingService] Program: ${programTitle}`);
    console.log(`  Start: ${programStart.toISOString()}`);
    console.log(`  End: ${programEnd.toISOString()}`);
    console.log(`  Current: ${now.toISOString()}`);
    console.log(`  Active: ${timing.isActive}`);
    console.log(`  Seek Offset: ${Math.floor(timing.seekOffsetMs / 1000)}s (${timing.seekOffsetMs}ms)`);
    console.log(`  Remaining: ${Math.floor(timing.remainingMs / 1000)}s (${timing.remainingMs}ms)`);
  }
  
  /**
   * Format duration in milliseconds to human readable format
   */
  static formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // ───────────────────────────────────────────────────
  // Catchup / Timeshift helpers
  // ───────────────────────────────────────────────────

  /**
   * Calculate the catchup window boundaries for a channel.
   * The window stretches from (now - catchupWindowHours) to now.
   */
  static calculateCatchupWindow(
    channel: CatchupChannel,
    now: Date = new Date()
  ): { start: Date; end: Date } {
    if (!channel.catchupEnabled) {
      // No catchup — return a zero-width window at "now"
      return { start: now, end: now };
    }
    const windowMs = channel.catchupWindowHours * 60 * 60 * 1000;
    const start = new Date(now.getTime() - windowMs);
    return { start, end: now };
  }

  /**
   * Determine whether a program is still within the catchup window.
   */
  static isProgramCatchupAvailable(
    program: CatchupProgram,
    channel: CatchupChannel,
    now: Date = new Date()
  ): boolean {
    if (!channel.catchupEnabled) return false;
    if (program.catchupAvailable === false) return false;

    // If an explicit expiry is set and has passed, catchup is gone
    if (program.catchupExpiry && new Date(program.catchupExpiry) < now) {
      return false;
    }

    const programStart = new Date(program.startTime);
    const programEnd = new Date(programStart.getTime() + program.duration);

    // Program must have already started (at least partially aired)
    if (programStart > now) return false;

    // The programme's air time must fall inside the catchup window
    const { start: windowStart } = this.calculateCatchupWindow(channel, now);
    return programEnd > windowStart;
  }

  /**
   * Calculate the seek offset (in ms) for a catchup request.
   *
   * If `requestedTime` is within the programme's air window, the seek offset
   * is the distance from the programme start to the requested time.
   * Otherwise, seek to the beginning of the programme (offset 0).
   */
  static getCatchupSeekOffset(
    program: CatchupProgram,
    requestedTime: Date
  ): { seekOffsetMs: number; remainingMs: number } {
    const programStart = new Date(program.startTime);
    const programEnd = new Date(programStart.getTime() + program.duration);

    // Clamp the requested time to within the programme
    const clampedTime = new Date(
      Math.max(programStart.getTime(), Math.min(programEnd.getTime(), requestedTime.getTime()))
    );

    const seekOffsetMs = clampedTime.getTime() - programStart.getTime();
    const remainingMs = programEnd.getTime() - clampedTime.getTime();

    return {
      seekOffsetMs: Math.max(0, seekOffsetMs),
      remainingMs: Math.max(0, remainingMs),
    };
  }

  /**
   * Calculate the catchup expiry DateTime for a program based on its channel settings.
   * Used when generating programs to pre-populate the catchupExpiry field.
   */
  static calculateCatchupExpiry(
    programEndTime: Date,
    catchupWindowHours: number
  ): Date {
    return new Date(programEndTime.getTime() + catchupWindowHours * 60 * 60 * 1000);
  }
}

export default TimingService; 