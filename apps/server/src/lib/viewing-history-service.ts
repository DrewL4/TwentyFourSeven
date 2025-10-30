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
  sessionId?: string;
  viewerName?: string; // From Viewer mapping
}

export class ViewingHistoryService {
  private static instance: ViewingHistoryService;
  private viewerNameCache: Map<string, string> = new Map();
  private cacheTimestamp: number = 0;
  private cacheTTL: number = 60000; // 1 minute

  static getInstance(): ViewingHistoryService {
    if (!ViewingHistoryService.instance) {
      ViewingHistoryService.instance = new ViewingHistoryService();
    }
    return ViewingHistoryService.instance;
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
      await prisma.viewingHistory.create({
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
    } catch (error) {
      console.error(`[ViewingHistory] Failed to record session start for ${sessionId}:`, error);
      // Don't throw - logging should not break streaming
    }
  }

  /**
   * Record session end and update duration
   */
  async recordSessionEnd(
    sessionId: string,
    status: 'completed' | 'failed' = 'completed'
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

        await prisma.viewingHistory.update({
          where: { id: history.id },
          data: {
            endTime,
            duration,
            status,
          },
        });
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
        const viewerName = await this.getViewerName(entry.ipAddress);
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
          sessionId: entry.sessionId || undefined,
          viewerName,
        };
      })
    );

    return {
      entries: enrichedEntries,
      total,
    };
  }

  async createIpMapping(data: { ipAddress: string; name: string; notes?: string }): Promise<any> {
    return await prisma.viewer.create({
      data: {
        ipAddress: data.ipAddress,
        name: data.name,
        notes: data.notes,
      },
    });
  }

  /**
   * Clear viewer name cache (useful after mapping updates)
   */
  clearCache(): void {
    this.viewerNameCache.clear();
    this.cacheTimestamp = 0;
  }
}

export const viewingHistoryService = ViewingHistoryService.getInstance();

