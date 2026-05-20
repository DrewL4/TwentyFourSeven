import { prisma } from './prisma';
import { streamMonitorService } from './stream-monitor-service';

export interface ActiveViewer {
  sessionId: string;
  ipAddress: string;
  channelNumber: number;
  channelName?: string;
  programTitle?: string;
  startTime: Date;
  duration: number; // Seconds since start
  status: string;
  viewerName?: string; // From Viewer mapping
}

export interface ViewingHistoryEntry {
  id: string;
  ipAddress: string;
  channelNumber: number;
  channelName?: string;
  programTitle?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: string;
  statusMessage?: string;
  sessionId?: string;
  viewerName?: string; // From Viewer mapping
}

export interface ViewingSessionEntry {
  id: string;
  ipAddress: string;
  channelNumber: number;
  channelName?: string;
  viewerName?: string;
  sessionStart: Date;
  sessionEnd?: Date;
  totalDuration?: number;
  programCount: number;
  history: ViewingHistoryEntry[];
}

export class ViewingHistoryService {
  private static instance: ViewingHistoryService;
  private viewerNameCache: Map<string, string> = new Map();
  private cacheTimestamp: number = 0;
  private cacheTTL: number = 60000; // 1 minute
  private static readonly VIEWER_NAME_CACHE_MAX = 2000;

  static getInstance(): ViewingHistoryService {
    if (!ViewingHistoryService.instance) {
      ViewingHistoryService.instance = new ViewingHistoryService();
    }
    return ViewingHistoryService.instance;
  }

  /**
   * Check if IP address is blocked
   */
  async isIpBlocked(ipAddress: string): Promise<boolean> {
    try {
      const viewer = await prisma.viewer.findUnique({
        where: { ipAddress },
        select: { blocked: true },
      });
      return viewer?.blocked === true;
    } catch (error) {
      console.error(`[ViewingHistory] Failed to check IP block status for ${ipAddress}:`, error);
      return false; // Don't block on error
    }
  }

  /**
   * Record session start in viewing history
   */
  async recordSessionStart(
    sessionId: string,
    ipAddress: string,
    channelNumber: number,
    channelName?: string,
    programTitle?: string
  ): Promise<void> {
    try {
      // Check if IP is blocked
      const blocked = await this.isIpBlocked(ipAddress);
      if (blocked) {
        throw new Error(`IP address ${ipAddress} is blocked`);
      }

      const historyEntry = await prisma.viewingHistory.create({
        data: {
          sessionId,
          ipAddress,
          channelNumber,
          channelName,
          programTitle,
          startTime: new Date(),
          status: 'active',
        },
      });

      // Try to add to existing session or create new one
      await this.addToViewingSession(historyEntry.id, ipAddress, channelNumber, channelName);
    } catch (error: any) {
      if (error.message?.includes('blocked')) {
        throw error; // Re-throw blocking errors
      }
      console.error(`[ViewingHistory] Failed to record session start for ${sessionId}:`, error);
      // Don't throw - logging should not break streaming
    }
  }

  /**
   * Record session end and update duration
   */
  async recordSessionEnd(
    sessionId: string,
    status: 'completed' | 'failed' = 'completed',
    statusMessage?: string,
    errorDetails?: any
  ): Promise<void> {
    try {
      const history = await prisma.viewingHistory.findFirst({
        where: { sessionId },
        orderBy: { startTime: 'desc' },
      });

      if (history) {
        const endTime = new Date();
        const duration = Math.floor(
          (endTime.getTime() - history.startTime.getTime()) / 1000
        );

        // Get error details from stream monitor if available
        const session = streamMonitorService.getSession(sessionId);
        let finalStatusMessage = statusMessage;
        let finalErrorDetails = errorDetails;

        if (session) {
          if (session.lastError && !finalStatusMessage) {
            finalStatusMessage = session.lastError;
          }
          if (session.errorHistory && session.errorHistory.length > 0 && !finalErrorDetails) {
            finalErrorDetails = {
              lastError: session.lastError,
              errorHistory: session.errorHistory.map(e => ({
                timestamp: e.timestamp,
                error: e.error,
              })),
              recoveryAttempts: session.recoveryAttempts,
              status: session.status,
            };
          }
        }

        await prisma.viewingHistory.update({
          where: { id: history.id },
          data: {
            endTime,
            duration,
            status,
            statusMessage: finalStatusMessage,
            errorDetails: finalErrorDetails,
          },
        });

        // Update viewing session if exists
        if (history.viewingSessionId) {
          await this.updateViewingSession(history.viewingSessionId);
        }
      }
    } catch (error) {
      console.error(`[ViewingHistory] Failed to record session end for ${sessionId}:`, error);
      // Don't throw - logging should not break streaming
    }
  }

  /**
   * Get viewer name from cache or database
   */
  private async getViewerName(ipAddress: string): Promise<string | undefined> {
    // Check cache
    const now = Date.now();
    if (now - this.cacheTimestamp < this.cacheTTL) {
      const cached = this.viewerNameCache.get(ipAddress);
      if (cached) {
        return cached;
      }
    } else {
      // Refresh cache
      this.viewerNameCache.clear();
      this.cacheTimestamp = now;

      try {
        const viewers = await prisma.viewer.findMany({
          select: { ipAddress: true, name: true },
        });

        viewers.forEach((viewer) => {
          this.viewerNameCache.set(viewer.ipAddress, viewer.name);
        });
        this.trimViewerNameCache();
      } catch (error) {
        console.error('[ViewingHistory] Failed to refresh viewer name cache:', error);
      }
    }

    return this.viewerNameCache.get(ipAddress);
  }

  /**
   * Get currently active viewers
   */
  async getActiveViewers(): Promise<ActiveViewer[]> {
    const activeSessions = streamMonitorService.getActiveSessions();
    const activeViewers: ActiveViewer[] = [];

    // Get unique channel numbers to batch query channel names
    const channelNumbers = new Set(
      activeSessions.map((s) => s.channelNumber).filter(Boolean)
    );

    // Batch fetch channel names
    const channels = await prisma.channel.findMany({
      where: { number: { in: Array.from(channelNumbers) } },
      select: { number: true, name: true },
    });

    const channelMap = new Map(
      channels.map((c) => [c.number, c.name])
    );

    for (const session of activeSessions) {
      if (!session.clientIp) continue;

      const now = Date.now();
      const duration = Math.floor((now - session.startTime.getTime()) / 1000);

      const viewerName = await this.getViewerName(session.clientIp);
      const channelName = channelMap.get(session.channelNumber);

      activeViewers.push({
        sessionId: session.sessionId,
        ipAddress: session.clientIp,
        channelNumber: session.channelNumber,
        channelName,
        startTime: session.startTime,
        duration,
        status: session.status,
        viewerName,
      });
    }

    return activeViewers;
  }

  /**
   * Get viewing history with optional filters
   */
  async getViewingHistory(options?: {
    ipAddress?: string;
    viewerName?: string;
    startDate?: Date;
    endDate?: Date;
    channelNumber?: number;
    limit?: number;
    offset?: number;
  }): Promise<{
    entries: ViewingHistoryEntry[];
    total: number;
  }> {
    const {
      ipAddress,
      viewerName,
      startDate,
      endDate,
      channelNumber,
      limit = 50,
      offset = 0,
    } = options || {};

    const where: any = {};

    if (ipAddress) {
      where.ipAddress = ipAddress;
    }

    if (viewerName) {
      // Find IPs with this viewer name
      const viewers = await prisma.viewer.findMany({
        where: { name: viewerName },
        select: { ipAddress: true },
      });
      const ipAddresses = viewers.map(v => v.ipAddress);
      if (ipAddresses.length > 0) {
        where.ipAddress = { in: ipAddresses };
      } else {
        // No matches, return empty
        return { entries: [], total: 0 };
      }
    }

    if (channelNumber) {
      where.channelNumber = channelNumber;
    }

    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) {
        where.startTime.gte = startDate;
      }
      if (endDate) {
        where.startTime.lte = endDate;
      }
    }

    const [entries, total] = await Promise.all([
      prisma.viewingHistory.findMany({
        where,
        orderBy: { startTime: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.viewingHistory.count({ where }),
    ]);

    // Enrich with viewer names
    const enrichedEntries: ViewingHistoryEntry[] = await Promise.all(
      entries.map(async (entry) => {
        const viewerNameResult = await this.getViewerName(entry.ipAddress);
        return {
          id: entry.id,
          ipAddress: entry.ipAddress,
          channelNumber: entry.channelNumber,
          channelName: entry.channelName || undefined,
          programTitle: entry.programTitle || undefined,
          startTime: entry.startTime,
          endTime: entry.endTime || undefined,
          duration: entry.duration || undefined,
          status: entry.status,
          statusMessage: entry.statusMessage || undefined,
          sessionId: entry.sessionId || undefined,
          viewerName: viewerNameResult,
        };
      })
    );

    return {
      entries: enrichedEntries,
      total,
    };
  }

  /**
   * Add history entry to viewing session (group consecutive same-channel watches)
   */
  private async addToViewingSession(
    historyId: string,
    ipAddress: string,
    channelNumber: number,
    channelName?: string
  ): Promise<void> {
    try {
      // Find the most recent session for this IP and channel
      const recentSession = await prisma.viewingSession.findFirst({
        where: {
          ipAddress,
          channelNumber,
        },
        include: {
          history: {
            orderBy: { startTime: 'desc' },
            take: 1,
          },
        },
        orderBy: { sessionStart: 'desc' },
      });

      const now = new Date();
      const viewerName = await this.getViewerName(ipAddress);

      if (recentSession && recentSession.history.length > 0) {
        // Check if within 5 minutes of last history entry's end time (or start time if no end time)
        const lastEntry = recentSession.history[0];
        const lastActivityTime = lastEntry.endTime?.getTime() || lastEntry.startTime.getTime();
        const timeSinceLastActivity = now.getTime() - lastActivityTime;
        const fiveMinutes = 5 * 60 * 1000;

        if (timeSinceLastActivity < fiveMinutes) {
          // Add to existing session
          await prisma.viewingHistory.update({
            where: { id: historyId },
            data: { viewingSessionId: recentSession.id },
          });

          await prisma.viewingSession.update({
            where: { id: recentSession.id },
            data: {
              programCount: { increment: 1 },
              channelName: channelName || recentSession.channelName,
            },
          });
          return;
        }
      }

      // Create new session (different channel or gap > 5 minutes)
      const newSession = await prisma.viewingSession.create({
        data: {
          ipAddress,
          channelNumber,
          channelName,
          viewerName,
          sessionStart: now,
          programCount: 1,
        },
      });

      await prisma.viewingHistory.update({
        where: { id: historyId },
        data: { viewingSessionId: newSession.id },
      });
    } catch (error) {
      console.error(`[ViewingHistory] Failed to add to viewing session:`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Update viewing session totals
   */
  private async updateViewingSession(sessionId: string): Promise<void> {
    try {
      const session = await prisma.viewingSession.findUnique({
        where: { id: sessionId },
        include: { history: true },
      });

      if (!session) return;

      const completedHistory = session.history.filter(h => h.endTime && h.duration);
      const totalDuration = completedHistory.reduce((sum, h) => sum + (h.duration || 0), 0);
      const lastEndTime = session.history
        .filter(h => h.endTime)
        .sort((a, b) => b.endTime!.getTime() - a.endTime!.getTime())[0]?.endTime;

      await prisma.viewingSession.update({
        where: { id: sessionId },
        data: {
          totalDuration,
          sessionEnd: lastEndTime || undefined,
          programCount: session.history.length,
        },
      });
    } catch (error) {
      console.error(`[ViewingHistory] Failed to update viewing session:`, error);
    }
  }

  /**
   * Get viewing sessions (grouped history)
   */
  async getViewingSessions(options?: {
    ipAddress?: string;
    viewerName?: string;
    startDate?: Date;
    endDate?: Date;
    channelNumber?: number;
    limit?: number;
    offset?: number;
  }): Promise<{
    sessions: ViewingSessionEntry[];
    total: number;
  }> {
    try {
      const {
        ipAddress,
        viewerName,
        startDate,
        endDate,
        channelNumber,
        limit = 50,
        offset = 0,
      } = options || {};

      const where: any = {};

      if (ipAddress) {
        where.ipAddress = ipAddress;
      }

      if (viewerName) {
        where.viewerName = viewerName;
      }

      if (channelNumber) {
        where.channelNumber = channelNumber;
      }

      if (startDate || endDate) {
        where.sessionStart = {};
        if (startDate) {
          where.sessionStart.gte = startDate;
        }
        if (endDate) {
          where.sessionStart.lte = endDate;
        }
      }

      const [sessions, total] = await Promise.all([
        prisma.viewingSession.findMany({
          where,
          include: {
            history: {
              orderBy: { startTime: 'asc' },
            },
          },
          orderBy: { sessionStart: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.viewingSession.count({ where }),
      ]);

      // Enrich with viewer names and format
      const enrichedSessions: ViewingSessionEntry[] = sessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        channelNumber: session.channelNumber,
        channelName: session.channelName || undefined,
        viewerName: session.viewerName || undefined,
        sessionStart: session.sessionStart,
        sessionEnd: session.sessionEnd || undefined,
        totalDuration: session.totalDuration || undefined,
        programCount: session.programCount,
        history: session.history.map((h) => ({
          id: h.id,
          ipAddress: h.ipAddress,
          channelNumber: h.channelNumber,
          channelName: h.channelName || undefined,
          programTitle: h.programTitle || undefined,
          startTime: h.startTime,
          endTime: h.endTime || undefined,
          duration: h.duration || undefined,
          status: h.status,
          statusMessage: h.statusMessage || undefined,
          sessionId: h.sessionId || undefined,
          viewerName: session.viewerName || undefined,
        })),
      }));

      return {
        sessions: enrichedSessions,
        total,
      };
    } catch (error: any) {
      // If table doesn't exist or other database error, return empty result
      console.error('[ViewingHistory] Error fetching viewing sessions:', error);
      return {
        sessions: [],
        total: 0,
      };
    }
  }

  async createIpMapping(data: {
    ipAddress: string;
    name: string;
    notes?: string;
    userId?: string;
    blocked?: boolean;
  }): Promise<any> {
    return await prisma.viewer.upsert({
      where: { ipAddress: data.ipAddress },
      update: {
        name: data.name,
        notes: data.notes,
        userId: data.userId,
        blocked: data.blocked ?? false,
      },
      create: {
        ipAddress: data.ipAddress,
        name: data.name,
        notes: data.notes,
        userId: data.userId,
        blocked: data.blocked ?? false,
      },
    });
  }

  /**
   * Block an IP address
   */
  async blockIp(ipAddress: string): Promise<any> {
    return await prisma.viewer.updateMany({
      where: { ipAddress },
      data: { blocked: true },
    });
  }

  /**
   * Unblock an IP address
   */
  async unblockIp(ipAddress: string): Promise<any> {
    return await prisma.viewer.updateMany({
      where: { ipAddress },
      data: { blocked: false },
    });
  }

  /**
   * Assign IP to user
   */
  async assignIpToUser(ipAddress: string, userId: string): Promise<any> {
    return await prisma.viewer.updateMany({
      where: { ipAddress },
      data: { userId },
    });
  }

  /**
   * Clear viewer name cache (useful after mapping updates)
   */
  clearCache(): void {
    this.viewerNameCache.clear();
    this.cacheTimestamp = 0;
  }

  trimViewerNameCache(): void {
    if (this.viewerNameCache.size <= ViewingHistoryService.VIEWER_NAME_CACHE_MAX) {
      return;
    }
    const excess =
      this.viewerNameCache.size - ViewingHistoryService.VIEWER_NAME_CACHE_MAX;
    const keysToRemove = [...this.viewerNameCache.keys()].slice(0, excess);
    for (const key of keysToRemove) {
      this.viewerNameCache.delete(key);
    }
  }

  evictViewerNameCache(): void {
    const now = Date.now();
    if (now - this.cacheTimestamp >= this.cacheTTL) {
      this.viewerNameCache.clear();
      this.cacheTimestamp = 0;
    } else {
      this.trimViewerNameCache();
    }
  }

  /**
   * Delete viewing history and sessions older than configured retention.
   */
  async cleanupOldViewingHistory(): Promise<{
    historyDeleted: number;
    sessionsDeleted: number;
  }> {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { viewingHistoryRetentionDays: true },
    });
    const retentionDays = Math.max(
      1,
      settings?.viewingHistoryRetentionDays ?? 90,
    );
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    );

    const historyResult = await prisma.viewingHistory.deleteMany({
      where: { startTime: { lt: cutoff } },
    });

    const sessionsResult = await prisma.viewingSession.deleteMany({
      where: { sessionStart: { lt: cutoff } },
    });

    console.log(
      `[ViewingHistory] Pruned ${historyResult.count} history rows and ${sessionsResult.count} sessions older than ${retentionDays} days`,
    );

    return {
      historyDeleted: historyResult.count,
      sessionsDeleted: sessionsResult.count,
    };
  }
}

export const viewingHistoryService = ViewingHistoryService.getInstance();

