import { prisma } from './prisma';

export class ProgrammingService {
  private generationLocks = new Set<string>();
  private static globalLock = new Map<string, Promise<void>>();
  
  /**
   * Check if a program would overlap with existing programs on the same channel
   */
  private async checkForOverlaps(channelId: string, startTime: Date, duration: number, excludeProgramId?: string): Promise<boolean> {
    const programStart = startTime.getTime();
    const programEnd = programStart + duration;
    
    const existingPrograms = await prisma.program.findMany({
      where: {
        channelId,
        ...(excludeProgramId ? { id: { not: excludeProgramId } } : {}),
        OR: [
          // Program starts during another program
          {
            AND: [
              { startTime: { lte: new Date(programStart) } },
              { 
                startTime: {
                  gt: new Date(programStart - 60000) // Within 1 minute buffer for safety
                }
              }
            ]
          },
          // Program ends during another program
          {
            AND: [
              { startTime: { lt: new Date(programEnd) } },
              { 
                startTime: {
                  gte: new Date(programStart)
                }
              }
            ]
          }
        ]
      },
      select: {
        id: true,
        startTime: true,
        duration: true
      }
    });

    // Check each existing program for actual overlap
    for (const existing of existingPrograms) {
      const existingStart = existing.startTime.getTime();
      const existingEnd = existingStart + existing.duration;
      
      // Check if programs overlap
      const overlap = programStart < existingEnd && programEnd > existingStart;
      
      if (overlap) {
        console.warn(`Program overlap detected on channel ${channelId}:
          New program: ${new Date(programStart).toISOString()} - ${new Date(programEnd).toISOString()}
          Existing program: ${new Date(existingStart).toISOString()} - ${new Date(existingEnd).toISOString()}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Remove overlapping programs before inserting new ones
   */
  private async removeOverlappingPrograms(channelId: string, programs: Array<{ startTime: Date, duration: number }>): Promise<void> {
    for (const program of programs) {
      const programStart = program.startTime.getTime();
      const programEnd = programStart + program.duration;
      
      // Find and delete any overlapping programs
      const overlappingPrograms = await prisma.program.findMany({
        where: {
          channelId,
          OR: [
            // Existing program starts during new program
            {
              AND: [
                { startTime: { gte: new Date(programStart) } },
                { startTime: { lt: new Date(programEnd) } }
              ]
            },
            // Existing program ends during new program
            {
              AND: [
                { startTime: { lt: new Date(programStart) } }
                // We need to check if startTime + duration > programStart
                // Since we can't do math in Prisma queries, we'll check this in code
              ]
            }
          ]
        },
        select: {
          id: true,
          startTime: true,
          duration: true
        }
      });

      // Filter results to only include actual overlaps
      const actualOverlaps = overlappingPrograms.filter(existing => {
        const existingStart = existing.startTime.getTime();
        const existingEnd = existingStart + existing.duration;
        
        return programStart < existingEnd && programEnd > existingStart;
      });

      if (actualOverlaps.length > 0) {
        console.log(`Removing ${actualOverlaps.length} overlapping programs for channel ${channelId}`);
        await prisma.program.deleteMany({
          where: {
            id: {
              in: actualOverlaps.map(p => p.id)
            }
          }
        });
      }
    }
  }

  /**
   * Verify that no overlaps exist on a channel and no gaps exist between programs
   */
  private async verifyNoOverlaps(channelId: string): Promise<{ success: boolean, overlaps: Array<{ program1: any, program2: any }> }> {
    const programs = await prisma.program.findMany({
      where: { channelId },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        duration: true
      }
    });

    const overlaps = [];
    
    for (let i = 0; i < programs.length - 1; i++) {
      const current = programs[i];
      const next = programs[i + 1];
      
      const currentEnd = current.startTime.getTime() + current.duration;
      const nextStart = next.startTime.getTime();
      
      if (currentEnd > nextStart) {
        overlaps.push({
          program1: current,
          program2: next
        });
      }
    }

    return {
      success: overlaps.length === 0,
      overlaps
    };
  }

  /**
   * Verify that there are no gaps between programs on a channel
   */
  private async verifyNoGaps(channelId: string): Promise<{ success: boolean, gaps: Array<{ program1: any, program2: any, gapDuration: number }> }> {
    const programs = await prisma.program.findMany({
      where: { channelId },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        duration: true
      }
    });

    const gaps = [];
    
    for (let i = 0; i < programs.length - 1; i++) {
      const current = programs[i];
      const next = programs[i + 1];
      
      const currentEnd = current.startTime.getTime() + current.duration;
      const nextStart = next.startTime.getTime();
      
      // Allow for small timing discrepancies (up to 1 second)
      const gapDuration = nextStart - currentEnd;
      if (gapDuration > 1000) { // More than 1 second gap
        gaps.push({
          program1: current,
          program2: next,
          gapDuration
        });
      }
    }

    return {
      success: gaps.length === 0,
      gaps
    };
  }

  /**
   * Clean up any overlapping programs on a specific channel
   */
  private async cleanupOverlapsForChannel(channelId: string): Promise<void> {
    const verificationResult = await this.verifyNoOverlaps(channelId);
    
    if (verificationResult.success) {
      return; // No overlaps to clean up
    }

    console.log(`Cleaning up ${verificationResult.overlaps.length} overlaps on channel ${channelId}`);
    
    // For each overlap, keep the earlier program and remove the later one
    const programsToDelete = new Set<string>();
    
    for (const overlap of verificationResult.overlaps) {
      // Keep the earlier program, mark the later one for deletion
      const program1Start = overlap.program1.startTime.getTime();
      const program2Start = overlap.program2.startTime.getTime();
      
      if (program1Start < program2Start) {
        programsToDelete.add(overlap.program2.id);
      } else {
        programsToDelete.add(overlap.program1.id);
      }
    }

    if (programsToDelete.size > 0) {
      await prisma.program.deleteMany({
        where: {
          id: {
            in: Array.from(programsToDelete)
          }
        }
      });
      
      console.log(`Removed ${programsToDelete.size} overlapping programs from channel ${channelId}`);
    }
  }

  /**
   * Get guide days setting from database
   */
  private async getGuideDays(): Promise<number> {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" }
    });
    return settings?.guideDays || 3; // Default to 3 days
  }

  /**
   * Generate programs for a specific channel
   */
  async generateProgramsForChannel(channelId: string, customHours?: number) {
    // Check if there's already a pending operation for this channel
    if (ProgrammingService.globalLock.has(channelId)) {
      console.log(`Waiting for existing channel operation to complete for channel ${channelId}`);
      await ProgrammingService.globalLock.get(channelId);
      console.log(`Previous operation completed for channel ${channelId}, proceeding with generation`);
    }

    // Prevent concurrent generation for the same channel
    if (this.generationLocks.has(channelId)) {
      console.log(`Program generation already in progress for channel ${channelId}, skipping`);
      return;
    }

    this.generationLocks.add(channelId);
    
    // Create a promise for this operation
    const operationPromise = this._doGeneratePrograms(channelId, customHours);
    ProgrammingService.globalLock.set(channelId, operationPromise);
    
    try {
      await operationPromise;
    } finally {
      // Always remove locks when done
      this.generationLocks.delete(channelId);
      ProgrammingService.globalLock.delete(channelId);
    }
  }

  private async _doGeneratePrograms(channelId: string, customHours?: number) {
      const guideDays = await this.getGuideDays();
      const hours = customHours || (guideDays * 24); // Use guideDays setting unless overridden
      
      const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        channelShows: {
          include: {
            show: {
              include: {
                episodes: {
                  orderBy: [
                    { seasonNumber: 'asc' },
                    { episodeNumber: 'asc' }
                  ]
                }
              }
            }
          },
          orderBy: { order: 'asc' }
        },
        channelMovies: {
          include: {
            movie: true
          },
          orderBy: { order: 'asc' }
        },
        programs: {
          where: {
            startTime: { gte: new Date() }
          },
          orderBy: { startTime: 'desc' },
          take: 1
        }
      }
    });

    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Determine start time for new programs
    const now = new Date();
    let startTime: Date;
    
    // Check if there's a currently running program that we should continue from
    const currentProgram = await prisma.program.findFirst({
      where: {
        channelId,
        startTime: { lte: now },
        // Program is currently running if startTime + duration > now
      },
      orderBy: { startTime: 'desc' }
    });

    if (currentProgram) {
      const programEnd = new Date(currentProgram.startTime.getTime() + currentProgram.duration);
      if (programEnd > now) {
        // Continue from where the current program ends (seamless transition)
        startTime = programEnd;
        console.log(`Continuing from current program end at ${startTime.toISOString()}`);
        
        // Only clear future programs, not the currently running one
        const deletedCount = await prisma.program.deleteMany({
          where: {
            channelId,
            startTime: { gt: now }
          }
        });
        console.log(`Deleted ${deletedCount.count} future programs for channel ${channel.name}, keeping current program`);
      } else {
        // Current program has ended, start immediately (no gap)
        startTime = new Date(now);
        startTime.setSeconds(0, 0); // Round to the second for cleaner times
        
        // Clear all future programs
        const deletedCount = await prisma.program.deleteMany({
          where: {
            channelId,
            startTime: { gte: now }
          }
        });
        console.log(`Deleted ${deletedCount.count} existing programs for channel ${channel.name}`);
      }
    } else {
      // No current program, start from now
      startTime = new Date(now);
      startTime.setSeconds(0, 0); // Round to the second for cleaner times
      
      // Clear all future programs
      const deletedCount = await prisma.program.deleteMany({
        where: {
          channelId,
          startTime: { gte: now }
        }
      });
      console.log(`Deleted ${deletedCount.count} existing programs for channel ${channel.name}`);
    }

    console.log(`Starting program generation for channel ${channel.name} at ${startTime.toISOString()} for ${hours} hours`);

    // Get all content for this channel and respect the order configured in channels
    const showItems = channel.channelShows.map(cs => ({
      order: cs.order,
      type: 'show' as const,
      channelShow: cs,
      episodes: cs.show.episodes.map(episode => ({
        type: 'episode' as const,
        content: episode,
        showTitle: cs.show.title,
        duration: episode.duration
      }))
    }));
    
    const movieItems = channel.channelMovies.map(cm => ({
      order: cm.order,
      type: 'movie' as const,
      item: {
        type: 'movie' as const,
        content: cm.movie,
        duration: cm.movie.duration
      }
    }));

    // Combine and sort by order to respect channel configuration
    const allItems = [...showItems, ...movieItems].sort((a, b) => a.order - b.order);
    
    // Flatten into the final content array respecting the configured order
    const allContent = [];
    for (const item of allItems) {
      if (item.type === 'show') {
        // Add all episodes from this show
        allContent.push(...item.episodes);
      } else {
        // Add this movie
        allContent.push(item.item);
      }
    }

    if (allContent.length === 0) {
      console.log(`No content found for channel ${channel.name} - channel will have no programming`);
      return;
    }

    // Generate programs for the specified duration
    const endTime = new Date(startTime.getTime() + (hours * 60 * 60 * 1000));
    let currentTime = new Date(startTime);
    let contentIndex = 0;

    const programs = [];

    // Always generate programming to fill the entire time period by looping content
    // Ensure programs are perfectly sequential with no gaps
    while (currentTime < endTime) {
      const item = allContent[contentIndex % allContent.length];
      
      // Create program entry with exact timing
      const program = {
        channelId,
        startTime: new Date(currentTime.getTime()), // Ensure exact millisecond precision
        duration: item.duration,
        ...(item.type === 'episode' 
          ? { episodeId: item.content.id }
          : { movieId: item.content.id }
        )
      };

      programs.push(program);

      // Move to next time slot - this ensures the next program starts exactly when this one ends
      currentTime = new Date(currentTime.getTime() + item.duration);
      contentIndex++;
      
      // Safety check to prevent infinite loops in case of very short content
      if (programs.length > 10000) {
        console.warn(`Generated maximum programs (10000) for channel ${channel.name} - stopping to prevent infinite loop`);
        break;
      }
    }

    console.log(`Generated ${programs.length} continuous programs from ${startTime.toISOString()} to ${currentTime.toISOString()}`);
    console.log(`✓ Programming covers ${Math.round((currentTime.getTime() - startTime.getTime()) / (60 * 60 * 1000) * 100) / 100} hours with no gaps`);

    // Remove any overlapping programs before inserting new ones
    console.log(`Checking for overlaps before inserting ${programs.length} programs...`);
    await this.removeOverlappingPrograms(channelId, programs);
    
    // Insert all programs
    await prisma.program.createMany({
      data: programs
    });

    // Verify no overlaps were created (safety check)
    const overlapCheck = await this.verifyNoOverlaps(channelId);
    if (!overlapCheck.success) {
      console.error(`Overlap verification failed for channel ${channel.name}:`, overlapCheck.overlaps);
      // Clean up any overlaps that may have been created
      await this.cleanupOverlapsForChannel(channelId);
    }

    // Verify no gaps exist between programs (quality check)
    const gapCheck = await this.verifyNoGaps(channelId);
    if (!gapCheck.success) {
      console.warn(`Gap verification found ${gapCheck.gaps.length} gaps for channel ${channel.name}:`);
      gapCheck.gaps.forEach((gap, index) => {
        const gapSeconds = Math.round(gap.gapDuration / 1000);
        console.warn(`  Gap ${index + 1}: ${gapSeconds} seconds between programs ending at ${new Date(gap.program1.startTime.getTime() + gap.program1.duration).toISOString()} and starting at ${gap.program2.startTime.toISOString()}`);
      });
    } else {
      console.log(`✓ Verified continuous programming with no gaps for channel ${channel.name}`);
    }

    console.log(`Generated ${programs.length} programs for channel ${channel.name} (looped content ${Math.ceil(programs.length / allContent.length)} times)`);
  }

  /**
   * Generate programs for all channels
   */
  async generateProgramsForAllChannels(customHours?: number) {
    const guideDays = await this.getGuideDays();
    const hours = customHours || (guideDays * 24); // Use guideDays setting unless overridden
    
    const channels = await prisma.channel.findMany({
      select: { id: true, name: true }
    });

    console.log(`Generating programs for all ${channels.length} channels for ${hours} hours`);

    for (const channel of channels) {
      try {
        await this.generateProgramsForChannel(channel.id, hours);
      } catch (error) {
        console.error(`Error generating programs for channel ${channel.name}:`, error);
      }
    }
  }

  /**
   * Auto-regenerate programs as needed (should be called periodically)
   * 
   * This is the core method that ensures channels never end. It:
   * 1. Checks each channel's last scheduled program
   * 2. Ensures programming extends to at least 'guideDays' into the future
   * 3. Appends new programs seamlessly from where the schedule ends
   * 4. Maintains content rotation order across extensions
   * 
   * This method is called:
   * - On server startup (if programs exist)
   * - Every hour via the scheduler
   * - Manually via API endpoints
   * 
   * The algorithm ensures:
   * - No gaps between programs
   * - Content continues in the same rotation order
   * - Currently playing programs are never affected
   * - Database efficiency through targeted updates
   */
  async maintainPrograms() {
    const guideDays = await this.getGuideDays();
    const now = new Date();
    const lookAhead = new Date(now.getTime() + (guideDays * 24 * 60 * 60 * 1000));

    // Find all channels
    const channels = await prisma.channel.findMany({
      select: { id: true, name: true }
    });

    for (const channel of channels) {
      // Find the last scheduled program for this channel
      const lastProgram = await prisma.program.findFirst({
        where: { channelId: channel.id },
        orderBy: { startTime: 'desc' }
      });
      let startTime = now;
      if (lastProgram) {
        const lastEnd = new Date(lastProgram.startTime.getTime() + lastProgram.duration);
        if (lastEnd > now) {
          startTime = lastEnd;
        }
      }
      // Only append if needed
      if (!lastProgram || startTime < lookAhead) {
        await this.appendProgramsForChannel(channel.id, startTime, lookAhead);
      }
    }
  }

  // Helper to append programs for a channel from startTime to endTime
  async appendProgramsForChannel(channelId: string, startTime: Date, endTime: Date) {
    // Get the current lineup for the channel
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        channelShows: {
          include: {
            show: {
              include: {
                episodes: {
                  orderBy: [
                    { seasonNumber: 'asc' },
                    { episodeNumber: 'asc' }
                  ]
                }
              }
            }
          },
          orderBy: { order: 'asc' }
        },
        channelMovies: {
          include: { movie: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    if (!channel) return;
    // Build the content lineup (same as in _doGeneratePrograms)
    const showItems = channel.channelShows.map(cs => ({
      order: cs.order,
      type: 'show' as const,
      channelShow: cs,
      episodes: cs.show.episodes.map(episode => ({
        type: 'episode' as const,
        content: episode,
        showTitle: cs.show.title,
        duration: episode.duration
      }))
    }));
    const movieItems = channel.channelMovies.map(cm => ({
      order: cm.order,
      type: 'movie' as const,
      item: {
        type: 'movie' as const,
        content: cm.movie,
        duration: cm.movie.duration
      }
    }));
    const allItems = [...showItems, ...movieItems].sort((a, b) => a.order - b.order);
    // Flatten into the final content array respecting the configured order
    const allContent = [];
    for (const item of allItems) {
      if (item.type === 'show') {
        allContent.push(...item.episodes);
      } else {
        allContent.push(item.item);
      }
    }
    if (allContent.length === 0) return;
    // Find where to start in the rotation
    let contentIndex = 0;
    if (startTime > new Date()) {
      // Find the last scheduled program to determine the next item in rotation
      const lastProgram = await prisma.program.findFirst({
        where: { channelId },
        orderBy: { startTime: 'desc' }
      });
      if (lastProgram) {
        // Find the index of the last item used
        const lastId = lastProgram.episodeId || lastProgram.movieId;
        contentIndex = allContent.findIndex(item =>
          (item.type === 'episode' && item.content.id === lastProgram.episodeId) ||
          (item.type === 'movie' && item.content.id === lastProgram.movieId)
        );
        if (contentIndex === -1) contentIndex = 0;
        contentIndex = (contentIndex + 1) % allContent.length;
      }
    }
    let currentTime = new Date(startTime);
    const programs = [];
    while (currentTime < endTime) {
      const item = allContent[contentIndex % allContent.length];
      const program = {
        channelId,
        startTime: new Date(currentTime.getTime()),
        duration: item.duration,
        ...(item.type === 'episode' ? { episodeId: item.content.id } : { movieId: item.content.id })
      };
      programs.push(program);
      currentTime = new Date(currentTime.getTime() + item.duration);
      contentIndex++;
      if (programs.length > 10000) break;
    }
    if (programs.length > 0) {
      await prisma.program.createMany({ data: programs });
    }
  }

  /**
   * Clean up old programs to prevent database bloat
   */
  async cleanupOldPrograms() {
    const cutoff = new Date(Date.now() - (24 * 60 * 60 * 1000)); // 24 hours ago
    
    const result = await prisma.program.deleteMany({
      where: {
        startTime: { lt: cutoff }
      }
    });

    console.log(`Cleaned up ${result.count} old programs`);
  }

  /**
   * Public method to clean up overlaps across all channels
   */
  async cleanupAllOverlaps() {
    const channels = await prisma.channel.findMany({
      select: { id: true, name: true }
    });

    let totalOverlapsFixed = 0;

    for (const channel of channels) {
      const overlapCheck = await this.verifyNoOverlaps(channel.id);
      if (!overlapCheck.success) {
        console.log(`Cleaning up ${overlapCheck.overlaps.length} overlaps on channel ${channel.name}`);
        await this.cleanupOverlapsForChannel(channel.id);
        totalOverlapsFixed += overlapCheck.overlaps.length;
      }
    }

    console.log(`Total overlaps cleaned up across all channels: ${totalOverlapsFixed}`);
    return totalOverlapsFixed;
  }
}

export const programmingService = new ProgrammingService(); 