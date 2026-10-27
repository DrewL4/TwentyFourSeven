import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { adminProcedure, managerProcedure, protectedProcedure, publicProcedure } from "../lib/orpc";
import { prisma } from "../lib/prisma";
import { isAdmin, redactSettingsSecrets, requireAdminAsync } from "../lib/admin-auth";
import { viewingHistoryService } from "../lib/viewing-history-service";
import { buildChannelsListSummary, getChannelLineup, getChannelShowEpisodes } from "../lib/channel-queries";
import { guideRouter } from "./guide-router";
import { libraryRouter } from "./library-router";
import { franchisesRouter } from "./franchises-router";
import { youtubeRouter } from "./youtube-router";
import { resolvePlexCredentials, toPublicServer, tokenUpdate } from "../lib/media-server-public";
import { searchLibraryFacet } from "../lib/library-facets";

// Plex checks take either a token typed by the admin, or a saved server's id so the
// stored token is used server-side and never sent to the browser.
const plexCheckInput = z.object({
  url: z.string().url().optional(),
  token: z.string().optional(),
  serverId: z.string().optional(),
});

async function loadPlexCredentials(input: z.infer<typeof plexCheckInput>) {
  const stored = input.serverId
    ? await prisma.mediaServer.findUnique({
        where: { id: input.serverId },
        select: { url: true, token: true },
      })
    : null;
  if (input.serverId && !stored) return { error: "Server not found" };
  return resolvePlexCredentials(input, stored);
}

async function mediaSourceStatus() {
  const { getLocalScanState } = await import('../lib/local-media/scanner');
  const { describeLocalStatus } = await import('../lib/local-media/status-text');
  const { configuredLocalRoots } = await import('../lib/local-media/paths');
  const { mappedRoots } = await import('../lib/local-media/browse');
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  const enabled = settings?.localMediaEnabled ?? true;
  const scan = getLocalScanState();
  const mapped = await mappedRoots();
  const plexServers = await prisma.mediaServer.count({ where: { type: "PLEX", active: true } });
  const count = (type: "LOCAL" | "PLEX") =>
    Promise.all([
      prisma.mediaMovie.count({ where: { library: { available: true, server: { type, active: true } } } }),
      prisma.mediaShow.count({ where: { library: { available: true, server: { type, active: true } } } }),
    ]).then(([movies, shows]) => ({ movies, shows }));
  return {
    source: (settings?.mediaSource || (plexServers ? "PLEX" : "LOCAL")) as "LOCAL" | "PLEX" | "JELLYFIN" | "EMBY",
    local: {
      enabled,
      paths: settings?.localMediaPaths ?? "",
      folders: configuredLocalRoots(settings?.localMediaPaths),
      scanning: scan.running,
      lastScan: scan.finishedAt,
      mapped,
      status: describeLocalStatus(scan, { enabled, mapped }),
      counts: await count("LOCAL"),
    },
    plex: { connected: plexServers > 0, counts: await count("PLEX") },
  };
}

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }: { context: import('../lib/context').Context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),

  // Channel Management
  channels: {
    list: publicProcedure.handler(async () => {
      return buildChannelsListSummary();
    }),

    listSummary: publicProcedure.handler(async () => {
      return buildChannelsListSummary();
    }),

    createFromCollections: managerProcedure
      .input(z.object({
        collections: z.array(z.string()).optional(),
        groupTitle: z.string().optional(),
        preview: z.boolean().optional().default(false),
        conflictResolutions: z.array(z.object({
          original: z.string(),
          action: z.enum(['rename','merge','skip','create']),
          newName: z.string().optional(),
          targetChannelId: z.string().optional()
        })).optional()
      }))
      .handler(async ({ input }) => {
        // Determine source collections: provided list or all unique collections
        let sourceCollections: string[] = input.collections || [];
        if (sourceCollections.length === 0) {
          // Build list from DB
          const [movieCollections, showCollections] = await Promise.all([
            prisma.mediaMovie.findMany({ where: { collections: { not: null } }, select: { collections: true } }),
            prisma.mediaShow.findMany({ where: { collections: { not: null } }, select: { collections: true } }),
          ]);
          const set = new Set<string>();
          const add = (rows: { collections: string | null }[]) => {
            for (const r of rows) {
              if (!r.collections) continue;
              try {
                for (const c of JSON.parse(r.collections) as string[]) {
                  if (typeof c === 'string' && c.trim()) set.add(c.trim());
                }
              } catch {}
            }
          };
          add(movieCollections); add(showCollections);
          sourceCollections = Array.from(set).sort();
        }

        // Helpers
        const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const jaccard = (a: string, b: string): number => {
          const as = new Set(normalize(a).split(' ').filter(Boolean));
          const bs = new Set(normalize(b).split(' ').filter(Boolean));
          const inter = new Set([...as].filter(x => bs.has(x))).size;
          const uni = new Set([...as, ...bs]).size || 1;
          return inter / uni;
        };

        // Load existing channels once
        const existingChannels = await prisma.channel.findMany({ select: { id: true, name: true, number: true, filterCollections: true } });
        const usedNumbers = new Set(existingChannels.map(c => c.number));
        const nextNumber = () => { let n = 1; while (usedNumbers.has(n)) n++; usedNumbers.add(n); return n; };

        // Build plan and detect conflicts
        type PlanItem = { original: string; action: 'create'; proposedName: string; proposedNumber: number };
        const plan: PlanItem[] = [];
        const conflicts: Array<{ original: string; exactMatches: { id: string; name: string }[]; closeMatches: { id: string; name: string; score: number }[] }>= [];

        for (const collection of sourceCollections) {
          const exact = existingChannels.filter(c => normalize(c.name) === normalize(collection));
          const close = existingChannels
            .filter(c => normalize(c.name) !== normalize(collection))
            .map(c => ({ id: c.id, name: c.name, score: jaccard(c.name, collection) }))
            .filter(x => x.score >= 0.85 || normalize(x.name).includes(normalize(collection)) || normalize(collection).includes(normalize(x.name)));

          if (exact.length > 0 || close.length > 0) {
            conflicts.push({ original: collection, exactMatches: exact.map(e => ({ id: e.id, name: e.name })), closeMatches: close });
            continue;
          }

          plan.push({ original: collection, action: 'create', proposedName: collection, proposedNumber: nextNumber() });
        }

        if (input.preview || (conflicts.length > 0 && !input.conflictResolutions)) {
          return { preview: true, plan, conflicts };
        }

        // Apply conflict resolutions and create
        const results = await prisma.$transaction(async (tx) => {
          const res: Array<{ name: string; id?: string; action: string }> = [];

          // First, create all non-conflict planned items
          for (const p of plan) {
            const ch = await tx.channel.create({
              data: {
                number: p.proposedNumber,
                name: p.proposedName,
                groupTitle: input.groupTitle || null,
                autoFilterEnabled: true,
                filterType: 'both',
                filterCollections: JSON.stringify([p.original])
              }
            });
            res.push({ name: ch.name, id: ch.id, action: 'create' });
          }

          // Then handle conflicts if provided
          for (const r of input.conflictResolutions || []) {
            const originalName = r.original;
            if (r.action === 'skip') {
              res.push({ name: originalName, action: 'skip' });
              continue;
            }
            if (r.action === 'merge') {
              if (!r.targetChannelId) {
                res.push({ name: originalName, action: 'merge-missing-target' });
                continue;
              }
              const target = await tx.channel.findUnique({ where: { id: r.targetChannelId }, select: { id: true, filterCollections: true, name: true } });
              if (!target) { res.push({ name: originalName, action: 'merge-target-not-found' }); continue; }
              let existing: string[] = [];
              try { existing = target.filterCollections ? JSON.parse(target.filterCollections) : []; } catch {}
              if (!existing.includes(originalName)) existing.push(originalName);
              await tx.channel.update({ where: { id: target.id }, data: { filterCollections: JSON.stringify(existing), autoFilterEnabled: true } });
              res.push({ name: target.name, id: target.id, action: 'merge' });
              continue;
            }
            if (r.action === 'rename' || r.action === 'create') {
              const finalName = r.newName && r.newName.trim() ? r.newName.trim() : originalName;
              // Ensure a unique channel number
              const number = nextNumber();
              const ch = await tx.channel.create({
                data: {
                  number,
                  name: finalName,
                  groupTitle: input.groupTitle || null,
                  autoFilterEnabled: true,
                  filterType: 'both',
                  filterCollections: JSON.stringify([originalName])
                }
              });
              res.push({ name: ch.name, id: ch.id, action: r.action });
              continue;
            }
          }

          return res;
        });

        // Trigger automation (do not block)
        setImmediate(async () => {
          try {
            const { channelAutomationService } = await import('@/lib/channel-automation-service');
            await channelAutomationService.processAutomatedChannels();
          } catch (e) {
            
          }
        });

        return { preview: false, results };
      }),

    get: publicProcedure
      .input(
        z.object({
          id: z.string(),
          includePrograms: z.boolean().optional().default(false),
          programHoursAhead: z.number().min(1).max(168).optional().default(48),
          includeChannelShows: z.boolean().optional().default(true),
          includeChannelMovies: z.boolean().optional().default(true),
        }),
      )
      .handler(async ({ input }) => {
        const now = new Date();
        const programEnd = new Date(
          now.getTime() + input.programHoursAhead * 60 * 60 * 1000,
        );

        return prisma.channel.findUnique({
          where: { id: input.id },
          include: {
            ...(input.includePrograms
              ? {
                  programs: {
                    where: {
                      startTime: { gte: now, lte: programEnd },
                    },
                    include: {
                      episode: { include: { show: true } },
                      movie: true,
                    },
                    orderBy: { startTime: "asc" },
                  },
                }
              : {}),
            ...(input.includeChannelShows
              ? {
                  channelShows: {
                    include: {
                      show: {
                        include: {
                          _count: { select: { episodes: true } },
                        },
                      },
                    },
                  },
                }
              : {}),
            ...(input.includeChannelMovies
              ? {
                  channelMovies: {
                    include: { movie: true },
                  },
                }
              : {}),
          },
        });
      }),

    getLineup: publicProcedure
      .input(z.object({ id: z.string() }))
      .handler(async ({ input }) => {
        return getChannelLineup(input.id);
      }),

    getShowEpisodes: publicProcedure
      .input(
        z.object({
          channelId: z.string(),
          showId: z.string(),
        }),
      )
      .handler(async ({ input }) => {
        return getChannelShowEpisodes(input.channelId, input.showId);
      }),

    create: managerProcedure
      .input(z.object({
        number: z.number(),
        name: z.string(),
        icon: z.string().optional(),
        stealth: z.boolean().default(false),
        groupTitle: z.string().optional(),
        startTime: z.string().optional(),
        // Channel icon settings
        iconWidth: z.number().default(120),
        iconDuration: z.number().default(60),
        iconPosition: z.string().default("2"),
        // Guide settings
        guideFlexPlaceholder: z.string().default(""),
        guideMinimumDurationSeconds: z.number().default(300),
        // On-demand settings
        isOnDemand: z.boolean().default(false),
        onDemandModulo: z.number().default(1),
        // Episode memory settings
        episodeMemoryEnabled: z.boolean().default(false),
        // Catchup / Timeshift settings
        catchupEnabled: z.boolean().default(true),
        catchupWindowHours: z.number().min(1).max(48).default(24),
        // Automation filter settings
        autoFilterEnabled: z.boolean().default(false),
        filterGenres: z.string().optional(),
        filterActors: z.string().optional(),
        filterDirectors: z.string().optional(),
        filterStudios: z.string().optional(),
        filterCollections: z.string().optional(),
        filterYearStart: z.number().optional(),
        filterYearEnd: z.number().optional(),
        filterRating: z.string().optional(),
        filterType: z.string().default("both")
      }))
      .handler(async ({ input }) => {
        return await prisma.channel.create({
          data: input
        });
      }),

    update: managerProcedure
      .input(z.object({
        id: z.string(),
        number: z.number().optional(),
        name: z.string().optional(),
        icon: z.string().optional(),
        stealth: z.boolean().optional(),
        groupTitle: z.string().optional(),
        startTime: z.string().optional(),
        // Channel icon settings
        iconWidth: z.number().optional(),
        iconDuration: z.number().optional(),
        iconPosition: z.string().optional(),
        // Guide settings
        guideFlexPlaceholder: z.string().optional(),
        guideMinimumDurationSeconds: z.number().optional(),
        // On-demand settings
        isOnDemand: z.boolean().optional(),
        onDemandModulo: z.number().optional(),
        // Episode memory settings
        episodeMemoryEnabled: z.boolean().optional(),
        // Catchup / Timeshift settings
        catchupEnabled: z.boolean().optional(),
        catchupWindowHours: z.number().min(1).max(48).optional(),
        // Automation filter settings
        autoFilterEnabled: z.boolean().optional(),
        filterGenres: z.string().optional(),
        filterActors: z.string().optional(),
        filterDirectors: z.string().optional(),
        filterStudios: z.string().optional(),
        filterCollections: z.string().optional(),
        filterYearStart: z.number().optional(),
        filterYearEnd: z.number().optional(),
        filterRating: z.string().optional(),
        filterType: z.string().optional()
      }))
      .handler(async ({ input }) => {
        const { id, ...data } = input;
        return await prisma.channel.update({
          where: { id },
          data
        });
      }),

    delete: managerProcedure
      .input(z.object({ id: z.string() }))
      .handler(async ({ input }) => {
        return await prisma.channel.delete({
          where: { id: input.id }
        });
      }),

    addShow: managerProcedure
      .input(z.object({
        channelId: z.string(),
        showId: z.string(),
        order: z.number().default(0),
        autoAddNewEpisodes: z.boolean().optional()
      }))
      .handler(async ({ input }) => {
        const { autoAddNewEpisodes = false, ...data } = input;
        const result = await prisma.channelShow.create({
          data: { ...data, autoAddNewEpisodes } as any
        });
        
        // Auto-generate programs for this channel starting from current time
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch (error) {
          
        }
        
        return result;
      }),

    removeShow: managerProcedure
      .input(z.object({
        channelId: z.string(),
        showId: z.string()
      }))
      .handler(async ({ input }) => {
        const result = await prisma.channelShow.delete({
          where: {
            channelId_showId: {
              channelId: input.channelId,
              showId: input.showId
            }
          }
        });
        
        // Auto-generate programs for this channel after removing content
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch (error) {
          
        }
        
        return result;
      }),

    addMovie: managerProcedure
      .input(z.object({
        channelId: z.string(),
        movieId: z.string(),
        order: z.number().default(0)
      }))
      .handler(async ({ input }) => {
        const result = await prisma.channelMovie.create({
          data: input
        });
        
        // Auto-generate programs for this channel starting from current time
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch (error) {
          
        }
        
        return result;
      }),

          removeMovie: managerProcedure
      .input(z.object({
        channelId: z.string(),
        movieId: z.string()
      }))
      .handler(async ({ input }) => {
        const result = await prisma.channelMovie.delete({
          where: {
            channelId_movieId: {
              channelId: input.channelId,
              movieId: input.movieId
            }
          }
        });
        
        // Auto-generate programs for this channel after removing content
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch (error) {
          
        }
        
        return result;
      }),

    generatePrograms: managerProcedure
      .input(z.object({
        channelId: z.string(),
        hours: z.number().default(24)
      }))
      .handler(async ({ input }) => {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForChannel(input.channelId, input.hours);
        return { success: true };
      }),

    updateShowOrder: managerProcedure
      .input(z.object({
        channelId: z.string(),
        showId: z.string(),
        order: z.number()
      }))
      .handler(async ({ input }) => {
        return await prisma.channelShow.update({
          where: {
            channelId_showId: {
              channelId: input.channelId,
              showId: input.showId
            }
          },
          data: {
            order: input.order
          }
        });
      }),

    updateMovieOrder: managerProcedure
      .input(z.object({
        channelId: z.string(),
        movieId: z.string(),
        order: z.number()
      }))
      .handler(async ({ input }) => {
        return await prisma.channelMovie.update({
          where: {
            channelId_movieId: {
              channelId: input.channelId,
              movieId: input.movieId
            }
          },
          data: {
            order: input.order
          }
        });
      }),

    // Channel automation endpoints
    processAutomation: managerProcedure
      .input(z.object({
        channelId: z.string()
      }))
      .handler(async ({ input }) => {
        const { channelAutomationService } = await import('@/lib/channel-automation-service');
        await channelAutomationService.processChannelById(input.channelId);
        return { success: true };
      }),

    processAllAutomation: managerProcedure
      .handler(async () => {
        const { channelAutomationService } = await import('@/lib/channel-automation-service');
        await channelAutomationService.processAutomatedChannels();
        return { success: true };
      }),

    updateFilters: managerProcedure
      .input(z.object({
        id: z.string(),
        autoFilterEnabled: z.boolean(),
        filterGenres: z.string().optional(),
        filterActors: z.string().optional(),
        filterDirectors: z.string().optional(),
        filterStudios: z.string().optional(),
        filterCollections: z.string().optional(),
        filterYearStart: z.number().optional(),
        filterYearEnd: z.number().optional(),
        filterRating: z.string().optional(),
        filterType: z.string(),
        // Advanced reorder options for automation
        defaultEpisodeOrder: z.string().optional(),
        respectEpisodeOrder: z.boolean().optional(),
        blockShuffle: z.boolean().optional(),
        blockShuffleSize: z.number().optional(),
        autoSortMethod: z.string().nullable().optional(),
        franchiseAutomation: z.boolean().optional(),
        franchiseId: z.string().nullable().optional(),
      }))
      .handler(async ({ input }) => {
        const { id, ...filters } = input;
        const { channelAutomationService } = await import('@/lib/channel-automation-service');
        await channelAutomationService.updateChannelFilters(id, filters);
        return { success: true };
      }),

    // Metadata endpoints for autocomplete (distinct values across movies and shows)
    getActors: managerProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => searchLibraryFacet("actors", input.search, input.limit)),

    getDirectors: managerProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => searchLibraryFacet("directors", input.search, input.limit)),

    getGenres: managerProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => searchLibraryFacet("genres", input.search, input.limit)),

    getStudios: managerProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => searchLibraryFacet("studio", input.search, input.limit)),

    reorderContent: managerProcedure
      .input(z.object({
        channelId: z.string(),
        items: z.array(z.object({
          id: z.string(),
          type: z.enum(['show', 'movie']),
          order: z.number()
        }))
      }))
      .handler(async ({ input }) => {
        const { channelId, items } = input;
        
        // Separate shows and movies
        const showUpdates = items.filter(item => item.type === 'show');
        const movieUpdates = items.filter(item => item.type === 'movie');
        
        // Use transaction to update all orders atomically
        const result = await prisma.$transaction(async (tx) => {
          // Update show orders
          const showPromises = showUpdates.map(item => 
            tx.channelShow.update({
              where: {
                channelId_showId: {
                  channelId,
                  showId: item.id
                }
              },
              data: { order: item.order }
            })
          );
          
          // Update movie orders
          const moviePromises = movieUpdates.map(item =>
            tx.channelMovie.update({
              where: {
                channelId_movieId: {
                  channelId,
                  movieId: item.id
                }
              },
              data: { order: item.order }
            })
          );
          
          // Execute all updates
          await Promise.all([...showPromises, ...moviePromises]);
          
          return { success: true, updated: items.length };
        });
        
        // Auto-generate programs for this channel after reordering content
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch (error) {
          
        }
        
        return result;
      }),

    reorderEpisodes: managerProcedure
      .input(z.object({
        channelId: z.string(),
        episodes: z.array(z.object({
          showId: z.string(),
          episodeId: z.string(),
          order: z.number()
        }))
      }))
      .handler(async ({ input }) => {
        const { channelId, episodes } = input;
        
        // Group episodes by show and determine new show order based on episode sequence
        const showOrderMap = new Map();
        let currentShowOrder = 0;
        
        episodes.forEach((episode) => {
          if (!showOrderMap.has(episode.showId)) {
            showOrderMap.set(episode.showId, currentShowOrder++);
          }
        });
        
        // Update show orders based on episode sequence
        const result = await prisma.$transaction(async (tx) => {
          const showPromises = Array.from(showOrderMap.entries()).map(([showId, order]) =>
            tx.channelShow.update({
              where: {
                channelId_showId: {
                  channelId,
                  showId
                }
              },
              data: { order }
            })
          );
          
          await Promise.all(showPromises);
          
          return { success: true, updated: episodes.length };
        });
        
        // Auto-generate programs for this channel after reordering episodes
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch (error) {
          
        }
        
        return result;
      }),

    // Quick Actions
    regenerateSchedule: managerProcedure
      .input(z.object({ channelId: z.string() }))
      .handler(async ({ input }) => {
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
          
          return { success: true, message: "Schedule regenerated successfully" };
        } catch (error) {
          
          throw new Error(`Failed to regenerate schedule: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),

    ensureAllChannelsHaveProgramming: managerProcedure
      .handler(async () => {
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.ensureAllChannelsHaveProgramming();
          
          return { success: true, message: "All channels now have programming. XMLTV should be fully populated." };
        } catch (error) {
          
          throw new Error(`Failed to ensure programming: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),

    cacheChannelCollectionIcons: managerProcedure
      .handler(async () => {
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.cacheChannelCollectionIcons();
          
          return {
            success: true,
            message: "Channel collection icons have been cached. XMLTV generation will now be much faster and won't require Plex API calls."
          };
        } catch (error) {
          
          throw new Error(`Failed to cache icons: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),

    shuffleAllContent: managerProcedure
      .input(z.object({ channelId: z.string() }))
      .handler(async ({ input }) => {
        const { channelId } = input;
        
        const result = await prisma.$transaction(async (tx) => {
          // Get all channel shows and movies
          const channelShows = await tx.channelShow.findMany({
            where: { channelId }
          });
          
          const channelMovies = await tx.channelMovie.findMany({
            where: { channelId }
          });
          
          // Combine and shuffle the order
          const allItems = [
            ...channelShows.map(cs => ({ id: cs.id, type: 'show', current: cs.order })),
            ...channelMovies.map(cm => ({ id: cm.id, type: 'movie', current: cm.order }))
          ];
          
          // Fisher-Yates shuffle algorithm
          for (let i = allItems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allItems[i], allItems[j]] = [allItems[j], allItems[i]];
          }
          
          // Update with new random orders
          const showUpdates = allItems
            .filter(item => item.type === 'show')
            .map((item, index) => 
              tx.channelShow.update({
                where: { id: item.id },
                data: { order: index }
              })
            );
          
          const movieUpdates = allItems
            .filter(item => item.type === 'movie')
            .map((item, index) => 
              tx.channelMovie.update({
                where: { id: item.id },
                data: { order: index + showUpdates.length }
              })
            );
          
          await Promise.all([...showUpdates, ...movieUpdates]);
          
          return { success: true, shuffled: allItems.length };
        });
        
        // Auto-generate programs for this channel after shuffling content
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch (error) {
          
        }
        
        return result;
      }),

    // Programming Rules
    updateChannelSettings: managerProcedure
      .input(z.object({
        channelId: z.string(),
        settings: z.object({
          defaultEpisodeOrder: z.enum(['sequential', 'random', 'shuffle']).optional(),
          respectEpisodeOrder: z.boolean().optional(),
          blockShuffle: z.boolean().optional()
        })
      }))
      .handler(async ({ input }) => {
        const { channelId, settings } = input;
        
        // For now, we'll store these as channel metadata
        // In a real implementation, you might want to add fields to the channel table
        return await prisma.channel.update({
          where: { id: channelId },
          data: {
            // Store settings in a JSON field if available, or handle separately
            // This is a simplified approach
          }
        });
      }),

    updateShowSettings: managerProcedure
      .input(z.object({
        channelId: z.string(),
        showId: z.string(),
        settings: z.object({
          shuffle: z.boolean().optional(),
          shuffleOrder: z.string().optional(),
          blockShuffle: z.boolean().optional(),
          blockShuffleSize: z.number().optional(),
          maxConsecutiveEpisodes: z.number().optional(),
          respectEpisodeOrder: z.boolean().optional()
        })
      }))
      .handler(async ({ input }) => {
        const { channelId, showId, settings } = input;
        
        return await prisma.channelShow.update({
          where: {
            channelId_showId: {
              channelId,
              showId
            }
          },
          data: settings
        });
      }),

    updateMovieSettings: managerProcedure
      .input(z.object({
        channelId: z.string(),
        movieId: z.string(),
        settings: z.object({
          shuffle: z.boolean().optional(),
          maxConsecutiveMovies: z.number().optional()
        })
      }))
      .handler(async ({ input }) => {
        const { channelId, movieId, settings } = input;
        
        return await prisma.channelMovie.update({
          where: {
            channelId_movieId: {
              channelId,
              movieId
            }
          },
          data: settings
        });
      }),

    sortByFranchise: managerProcedure
      .input(z.object({
        channelId: z.string(),
        franchiseSlug: z.string(),
      }))
      .handler(async ({ input }) => {
        const { syncFranchise } = await import('../lib/franchise-sync-service');
        const { applyFranchiseSortToChannel } = await import('../lib/franchise-sort-service');
        await syncFranchise(input.franchiseSlug);
        const result = await applyFranchiseSortToChannel(
          input.channelId,
          input.franchiseSlug,
        );
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
        } catch {
          // best-effort schedule regen
        }
        return result;
      }),
  },

  // Media Server Management
  servers: {
    list: adminProcedure.handler(async () => {
      const servers = await prisma.mediaServer.findMany({
        include: {
          libraries: {
            include: {
              shows: { take: 5 },
              movies: { take: 5 }
            }
          }
        }
      });
      return servers.map(toPublicServer);
    }),

    listForLibrary: managerProcedure.handler(async () => {
      return await prisma.mediaServer.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          active: true,
          libraries: {
            select: {
              id: true,
              name: true,
              type: true,
              _count: {
                select: { shows: true, movies: true },
              },
            },
          },
        },
      });
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string(),
        url: z.string().url(),
        token: z.string().optional(),
        type: z.enum(["PLEX", "JELLYFIN", "EMBY"]).default("PLEX"),
        active: z.boolean().default(true)
      }))
      .handler(async ({ input }) => {
        return toPublicServer(await prisma.mediaServer.create({
          data: { ...input, token: tokenUpdate(input.token) }
        }));
      }),

    update: adminProcedure
      .input(z.object({
        id: z.string(),
        name: z.string().optional(),
        url: z.string().url().optional(),
        token: z.string().optional(),
        type: z.enum(["PLEX", "JELLYFIN", "EMBY"]).optional(),
        active: z.boolean().optional()
      }))
      .handler(async ({ input }) => {
        const { id, token, ...data } = input;
        // A blank token field means "keep the stored token".
        return toPublicServer(await prisma.mediaServer.update({
          where: { id },
          data: { ...data, token: tokenUpdate(token) }
        }));
      }),

    delete: adminProcedure
      .input(z.object({ id: z.string() }))
      .handler(async ({ input }) => {
        return toPublicServer(await prisma.mediaServer.delete({
          where: { id: input.id }
        }));
      }),

    syncLibraries: adminProcedure
      .input(z.object({ serverId: z.string() }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.syncLibraries(input.serverId);
      }),

    testConnection: adminProcedure
      .input(plexCheckInput)
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        const creds = await loadPlexCredentials(input);
        if ('error' in creds) return { valid: false as const, error: creds.error };
        const result = await PlexService.testConnection(creds.url, creds.token);
        return result.ok ? { valid: true as const } : { valid: false as const, error: result.error };
      }),

    plexLogin: adminProcedure
      .input(z.object({
        username: z.string(),
        password: z.string()
      }))
      .handler(async ({ input }): Promise<{
        accessToken: string;
        user: { id: string; email: string; username: string };
        servers: Array<{
          name: string;
          machineIdentifier: string;
          accessToken: string;
          bestConnection: {
            uri: string;
            protocol: string;
            address: string;
            port: number;
            local: boolean;
          } | null;
          allConnections: Array<{
            uri: string;
            protocol: string;
            address: string;
            port: number;
            local: boolean;
          }>;
        }>;
      }> => {
        const { PlexService } = await import('../lib/plex-service');
        const { ORPCError } = await import('@orpc/server');
        
        try {
          // plex.tv tokens stay on the server; the browser gets short-lived handles.
          const { issuePlexTokenHandle } = await import('../lib/plex-login-handles');
          const result = await PlexService.login(input.username, input.password);
          return {
            ...result,
            accessToken: issuePlexTokenHandle(result.accessToken),
            servers: result.servers.map((server) => ({
              ...server,
              accessToken: issuePlexTokenHandle(server.accessToken),
            })),
          };
        } catch (error: any) {
          console.error('[plexLogin] Error:', error);
          
          // Handle authentication errors
          if (error?.message?.includes('Invalid username/password') || 
              error?.message?.includes('username/password') ||
              error?.status === 401) {
            throw new ORPCError('UNAUTHORIZED', { message: 'Invalid Plex username or password' });
          }
          
          // Handle network/timeout errors
          if (error?.message?.includes('fetch') || 
              error?.message?.includes('network') ||
              error?.message?.includes('timeout') ||
              error?.code === 'ETIMEDOUT' ||
              error?.code === 'ECONNREFUSED') {
            throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to connect to Plex servers. Please check your internet connection and try again.' });
          }
          
          // Handle missing access token errors
          if (error?.message?.includes('access token') || 
              error?.message?.includes('No access token')) {
            throw new ORPCError('UNAUTHORIZED', { message: 'Failed to authenticate with Plex. Please check your credentials.' });
          }
          
          // Handle server discovery errors
          if (error?.message?.includes('servers') || 
              error?.message?.includes('Failed to fetch')) {
            throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to discover Plex servers. Please try again later.' });
          }
          
          // Generic error fallback
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: error?.message || 'An unexpected error occurred during Plex login' });
        }
      }),

    addPlexServer: adminProcedure
      .input(z.object({
        name: z.string(),
        uri: z.string().url(),
        accessToken: z.string(),
        arGuide: z.boolean().optional().default(false),
        arChannels: z.boolean().optional().default(false),
        skipInitialLibrarySync: z.boolean().optional().default(false),
      }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        const accessToken = tokenUpdate(input.accessToken);
        if (!accessToken) {
          throw new ORPCError("BAD_REQUEST", { message: "Plex sign-in expired. Sign in to Plex again." });
        }
        return toPublicServer(await PlexService.addPlexServer({ ...input, accessToken }));
      }),

    getServerInfo: adminProcedure
      .input(plexCheckInput)
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        const creds = await loadPlexCredentials(input);
        if ('error' in creds) throw new ORPCError("BAD_REQUEST", { message: creds.error });
        return await PlexService.getServerInfo(creds.url, creds.token);
      }),

    getLibraries: adminProcedure
      .input(plexCheckInput)
      .handler(async ({ input }): Promise<Array<{
        key: string;
        title: string;
        type: string;
        agent: string;
        scanner: string;
        language: string;
        uuid: string;
        updatedAt: number;
        createdAt: number;
      }>> => {
        const { PlexAPI, PlexRequestError } = await import('../lib/plex');
        const {
          isPlexLibrarySyncable,
          normalizePlexLibraryKey,
        } = await import('../lib/plex-service');
        const creds = await loadPlexCredentials(input);
        if ('error' in creds) throw new ORPCError("BAD_REQUEST", { message: creds.error });
        const plex = new PlexAPI({ uri: creds.url });
        let libraries;
        try {
          libraries = await plex.getLibraries(creds.url, creds.token);
        } catch (error) {
          // A plain Error would reach the browser as "Internal server error".
          if (error instanceof PlexRequestError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
        return libraries
          .filter((lib) => isPlexLibrarySyncable(lib.type))
          .map((lib) => ({
            ...lib,
            key: normalizePlexLibraryKey(lib.key),
          }));
      }),

    syncLibrariesFast: adminProcedure
      .input(z.object({ serverId: z.string() }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.syncLibraries(input.serverId);
      }),

    updateLibrarySelection: adminProcedure
      .input(z.object({ 
        serverId: z.string(),
        selectedLibraryKeys: z.array(z.string())
      }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.updateLibrarySelection(input.serverId, input.selectedLibraryKeys);
      })
  },

  library: libraryRouter,

  franchises: franchisesRouter,
  youtube: youtubeRouter,

  // Catchup / Timeshift
  catchup: {
    getPrograms: publicProcedure
      .input(z.object({ channelNumber: z.number() }))
      .handler(async ({ input }) => {
        const { CatchupService } = await import('../lib/catchup-service');
        return await CatchupService.listCatchupPrograms(input.channelNumber);
      }),

    getStreamInfo: publicProcedure
      .input(z.object({
        channelNumber: z.number(),
        time: z.string(), // ISO-8601
        programId: z.string().optional(),
      }))
      .handler(async ({ input }) => {
        const { CatchupService } = await import('../lib/catchup-service');
        const requestedTime = input.time ? new Date(input.time) : undefined;
        const resolved = await CatchupService.resolveCatchupRequest(
          input.channelNumber,
          {
            requestedTime,
            programId: input.programId,
          },
        );
        if (!resolved) {
          throw new Error('No catchup stream available for the requested time');
        }
        const { program, seekOffsetMs, remainingMs } = resolved;
        return {
          programId: program.id,
          programTitle: CatchupService.getProgramTitle(program),
          seekOffset: Math.floor(seekOffsetMs / 1000),
          remainingMs,
          programStartTime: program.startTime.toISOString(),
          programEndTime: new Date(
            program.startTime.getTime() + program.duration,
          ).toISOString(),
          catchupExpiry: program.catchupExpiry?.toISOString() ?? null,
        };
      }),

    isAvailable: publicProcedure
      .input(z.object({ channelNumber: z.number() }))
      .handler(async ({ input }) => {
        const { CatchupService } = await import('../lib/catchup-service');
        const available = await CatchupService.isCatchupAvailable(input.channelNumber);
        return { available };
      }),
  },

  guide: guideRouter,

  // Programming Management
  programming: {
    generateForChannel: managerProcedure
      .input(z.object({
        channelId: z.string(),
        hours: z.number().optional()
      }))
      .handler(async ({ input }) => {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForChannel(input.channelId, input.hours);
        return { success: true };
      }),

    generateForAllChannels: managerProcedure
      .input(z.object({
        hours: z.number().optional()
      }))
      .handler(async ({ input }) => {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForAllChannels(input.hours);
        return { success: true };
      }),

    maintain: managerProcedure.handler(async () => {
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.maintainPrograms();
      return { success: true };
    }),

    cleanup: managerProcedure.handler(async () => {
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.cleanupOldPrograms();
      return { success: true };
    }),

    cleanupOverlaps: managerProcedure.handler(async () => {
      const { programmingService } = await import('@/lib/programming-service');
      const overlapsCleaned = await programmingService.cleanupAllOverlaps();
      return { success: true, overlapsCleaned };
    }),

    status: publicProcedure.handler(async () => {
      const now = new Date();
      const futurePrograms = await prisma.program.count({
        where: {
          startTime: { gte: now }
        }
      });
      
      const channels = await prisma.channel.count();
      
      return {
        futurePrograms,
        channels,
        hasPrograms: futurePrograms > 0
      };
    })
  },

  // System Management
  system: {
    fixXmltvProgramming: adminProcedure
      .handler(async () => {
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.ensureAllChannelsHaveProgramming();
          
          return {
            success: true,
            message: "XMLTV programming has been fixed. All channels now have programming data.",
            details: "This ensures that the /media.xml endpoint will return complete guide data for all channels."
          };
        } catch (error) {
          
          throw new Error(`Failed to fix XMLTV programming: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      })
  },

  // Settings Management
  settings: {
        get: publicProcedure.handler(async ({ context }) => {
      let settings = await prisma.settings.findUnique({
        where: { id: "singleton" },
        include: { plexSettings: true }
      });

      if (!settings) {
        settings = await prisma.settings.create({
          data: { id: "singleton" },
          include: { plexSettings: true }
        });
      }

      // Home and Guide read this as viewers too; only admins get secrets.
      const userId = context.session?.user?.id;
      if (userId && (await isAdmin(userId, prisma))) {
        return { ...settings, tmdbKeyConfigured: Boolean(settings.tmdbApiKey) };
      }
      return redactSettingsSecrets(settings);
    }),

    update: adminProcedure
      .input(z.object({
        port: z.number().optional(),
        ffmpegPath: z.string().optional(), // Temporary for compatibility
        concurrentStreams: z.number().min(0).max(99).optional(),
        hdhrActive: z.boolean().optional(),
        hdhrDeviceId: z.string().optional(),
        hdhrFriendlyName: z.string().optional(),
        hdhrTunerCount: z.number().optional(),
        guideDays: z.number().optional(),
        catchupEnabled: z.boolean().optional(),
        catchupDefaultWindow: z.number().min(1).max(48).optional(),
        tmdbApiKey: z.string().optional(),
        allowLanWithoutKey: z.boolean().optional(),
      }))
      .handler(async ({ input }) => {
        const data = { ...input };
        if (input.tmdbApiKey !== undefined) {
          const { normalizeTmdbApiKey, validateTmdbApiKey } = await import('../lib/tmdb-service');
          const normalized = normalizeTmdbApiKey(input.tmdbApiKey);
          if (!normalized && input.tmdbApiKey.trim()) {
            throw new Error(
              'Invalid TMDB API key. Paste only the 32-character v3 API Key from themoviedb.org/settings/api.',
            );
          }
          if (normalized) {
            const check = await validateTmdbApiKey(normalized);
            if (!check.valid) {
              throw new Error(check.message);
            }
            data.tmdbApiKey = normalized;
          } else {
            data.tmdbApiKey = '';
          }
        }
        return await prisma.settings.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", ...data },
          update: data
        });
      }),

    /** Where videos come from: local folders or a media server. */
    media: {
      status: adminProcedure.handler(async () => mediaSourceStatus()),

      scanNow: adminProcedure.handler(async () => {
        const { scanLocalMedia } = await import('../lib/local-media/scanner');
        const scan = scanLocalMedia();
        // Small folders finish right away; big ones keep going and the page polls.
        await Promise.race([scan, new Promise((r) => setTimeout(r, 3000))]);
        return mediaSourceStatus();
      }),

      setSource: adminProcedure
        .input(z.object({ source: z.enum(["LOCAL", "PLEX", "JELLYFIN", "EMBY"]) }))
        .handler(async ({ input }) => {
          if (input.source === "JELLYFIN" || input.source === "EMBY") {
            throw new ORPCError("BAD_REQUEST", { message: `${input.source === "EMBY" ? "Emby" : "Jellyfin"} is coming soon.` });
          }
          if (input.source === "PLEX") {
            const plex = await prisma.mediaServer.count({ where: { type: "PLEX", active: true } });
            if (!plex) throw new ORPCError("BAD_REQUEST", { message: "Connect your Plex server first, then choose Plex here." });
          }
          if (input.source === "LOCAL") {
            await prisma.settings.upsert({
              where: { id: "singleton" },
              create: { id: "singleton", localMediaEnabled: true },
              update: { localMediaEnabled: true },
            });
            const { scanLocalMedia, getLocalScanState } = await import('../lib/local-media/scanner');
            if (!getLocalScanState().finishedAt) await scanLocalMedia();
          }
          const { switchMediaSource } = await import('../lib/local-media/source-switch');
          const report = await switchMediaSource(input.source);
          return { ...report, status: await mediaSourceStatus() };
        }),

      /** Folder picker: one level of folders under /movies, /tv or /media (admin only). */
      browse: adminProcedure
        .input(z.object({ path: z.string().max(1024).optional() }))
        .handler(async ({ input }) => {
          const { listFolder } = await import('../lib/local-media/browse');
          const listing = await listFolder(input.path || null);
          if (!listing) throw new ORPCError("BAD_REQUEST", { message: "That folder can't be opened. Pick one from the list." });
          return listing;
        }),

      /** "Find my videos": a quick, time-boxed look for Movies and TV folders. */
      findVideos: adminProcedure.handler(async () => {
        const { findVideoFolders } = await import('../lib/local-media/browse');
        return findVideoFolders();
      }),

      /** Save the folders ticked in the picker, then scan them. */
      setFolders: adminProcedure
        .input(z.object({ folders: z.array(z.string().max(1024)).max(30) }))
        .handler(async ({ input }) => {
          const { cleanPickedFolders } = await import('../lib/local-media/browse');
          const { kept, rejected } = cleanPickedFolders(input.folders);
          if (rejected.length) {
            throw new ORPCError("BAD_REQUEST", { message: `TwentyFourSeven can't use ${rejected[0]}. Pick folders from the list.` });
          }
          const data = { localMediaPaths: kept.join(", "), localMediaEnabled: true };
          await prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
          const { scanLocalMedia } = await import('../lib/local-media/scanner');
          await Promise.race([scanLocalMedia(), new Promise((r) => setTimeout(r, 3000))]);
          return mediaSourceStatus();
        }),

      update: adminProcedure
        .input(z.object({ paths: z.string().max(2000).optional(), enabled: z.boolean().optional() }))
        .handler(async ({ input }) => {
          const data: { localMediaPaths?: string; localMediaEnabled?: boolean } = {};
          if (input.paths !== undefined) {
            const { configuredLocalRoots } = await import('../lib/local-media/paths');
            const parts = input.paths.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
            const kept = configuredLocalRoots(parts.join(","), {});
            if (parts.length && kept.length !== parts.length) {
              throw new ORPCError("BAD_REQUEST", { message: "Use folder paths inside the container that start with /, like /movies or /tv." });
            }
            data.localMediaPaths = kept.join(", ");
          }
          if (input.enabled !== undefined) data.localMediaEnabled = input.enabled;
          await prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });
          const { scanLocalMedia } = await import('../lib/local-media/scanner');
          await Promise.race([scanLocalMedia(), new Promise((r) => setTimeout(r, 3000))]);
          return mediaSourceStatus();
        }),
    },

    /** Links for IPTV apps and HDHomeRun clients, one revocable key per device. */
    playerKeys: {
      list: adminProcedure.handler(async () => {
        const { playerKeySecret } = await import('../lib/link-security');
        const keys = await prisma.playerKey.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "asc" } });
        const settings = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { allowLanWithoutKey: true } });
        return {
          allowLanWithoutKey: settings?.allowLanWithoutKey ?? true,
          keys: keys.map((key) => ({
            id: key.id,
            name: key.name,
            createdAt: key.createdAt,
            lastUsedAt: key.lastUsedAt,
            key: playerKeySecret(key.id),
          })),
        };
      }),

      create: adminProcedure
        .input(z.object({ name: z.string().trim().min(1).max(60) }))
        .handler(async ({ input, context }) => {
          const { playerKeySecret } = await import('../lib/link-security');
          const key = await prisma.playerKey.create({ data: { name: input.name, userId: context.session?.user?.id ?? null } });
          return { id: key.id, name: key.name, createdAt: key.createdAt, lastUsedAt: null, key: playerKeySecret(key.id) };
        }),

      revoke: adminProcedure
        .input(z.object({ id: z.string() }))
        .handler(async ({ input }) => {
          const { clearPlayerAccessCache } = await import('../lib/player-access');
          await prisma.playerKey.update({ where: { id: input.id }, data: { revokedAt: new Date() } });
          clearPlayerAccessCache();
          return { ok: true };
        }),
    },

    /**
     * Playlist logins for TV apps (Xtream Codes / M3U). Two modes: "tfs" (on its
     * own, logins kept here, ESPG's default rule) or "espg" (linked: logins come
     * from ESPG and are edited there). See lib/playlist-login.ts.
     */
    playlistLogin: {
      mine: protectedProcedure.handler(async ({ context }) => {
        const user = context.session?.user;
        if (!user?.id) throw new ORPCError("UNAUTHORIZED");
        const pl = await import('../lib/playlist-login');
        const { openSealedLogin } = await import('../lib/link-security');
        const s = await pl.loginSettings();
        if (s.mode === "espg") {
          if (!s.espgUrl) return { mode: "espg" as const, logins: [], custom: false, problem: new pl.LinkedWithoutAddressError().message };
          if (!s.hasToken) return { mode: "espg" as const, logins: [], custom: false, problem: new pl.LinkedWithoutTokenError().message };
          try {
            const res = await pl.playlistLogins.lookup(user.email);
            return {
              mode: "espg" as const,
              logins: res?.logins ?? [],
              custom: false,
              problem: res && res.logins.length === 0 ? "You don't have playlist access in ESPG yet. Ask your admin to give you a playlist in ESPG." : null,
            };
          } catch (e) {
            return { mode: "espg" as const, logins: [], custom: false, problem: e instanceof pl.LinkedWithoutTokenError || e instanceof pl.LinkedWithoutAddressError ? e.message : "Couldn't reach ESPG. Check the ESPG address in Settings." };
          }
        }
        let row = await prisma.playlistLogin.findUnique({ where: { userId: user.id } });
        if (!row) {
          await pl.makeDefaultLoginFor(user.id);
          row = await prisma.playlistLogin.findUnique({ where: { userId: user.id } });
        }
        const opened = row ? openSealedLogin(row.passwordSealed) : null;
        return {
          mode: "tfs" as const,
          logins: opened ? [{ playlist: "TwentyFourSeven", username: opened.username, password: opened.password }] : [],
          custom: !!row?.custom,
          problem: opened ? null : "Your playlist login needs a reset (the app secret changed).",
        };
      }),

      /** A person resets their own login back to the default (standalone only; not if an admin set it). */
      resetMine: protectedProcedure.handler(async ({ context }) => {
        const user = context.session?.user;
        if (!user?.id) throw new ORPCError("UNAUTHORIZED");
        const pl = await import('../lib/playlist-login');
        const s = await pl.loginSettings();
        if (s.mode !== "tfs") throw new ORPCError("BAD_REQUEST", { message: "Playlist logins come from ESPG. Change yours in ESPG." });
        const row = await prisma.playlistLogin.findUnique({ where: { userId: user.id }, select: { custom: true } });
        if (row?.custom) throw new ORPCError("BAD_REQUEST", { message: "Your admin set this login. Ask them to change it." });
        await pl.makeDefaultLoginFor(user.id);
        return { ok: true };
      }),

      /** Admin: mode, playlist name, ESPG address and what a switch would stop. */
      settings: adminProcedure.handler(async () => {
        const pl = await import('../lib/playlist-login');
        const s = await pl.loginSettings();
        const [localLogins, users] = await Promise.all([prisma.playlistLogin.count(), prisma.user.count()]);
        let problem: string | null = null;
        if (s.mode === "espg" && !s.espgUrl) problem = new pl.LinkedWithoutAddressError().message;
        else if (s.mode === "espg" && !s.hasToken) problem = new pl.LinkedWithoutTokenError().message;
        return {
          mode: s.mode,
          chosen: s.savedMode === "tfs" || s.savedMode === "espg",
          playlistName: s.playlistName,
          espgUrl: s.espgUrl,
          fromEnv: s.fromEnv,
          hasWatchTowerToken: s.hasToken,
          localLogins,
          users,
          problem,
        };
      }),

      setMode: adminProcedure
        .input(z.object({ mode: z.enum(["tfs", "espg"]) }))
        .handler(async ({ input, context }) => {
          await prisma.settings.upsert({
            where: { id: "singleton" },
            create: { id: "singleton", playlistLoginMode: input.mode },
            update: { playlistLoginMode: input.mode },
          });
          const pl = await import('../lib/playlist-login');
          pl.clearEspgLinkCache();
          pl.clearLoginCache();
          const s = await pl.loginSettings();
          if (input.mode === "tfs") return { ok: true, message: "Playlist logins are now kept by TwentyFourSeven. ESPG logins no longer work here." };
          if (!s.espgUrl) return { ok: false, message: new pl.LinkedWithoutAddressError().message };
          if (!s.hasToken) return { ok: false, message: new pl.LinkedWithoutTokenError().message };
          try {
            await pl.playlistLogins.lookup(context.session?.user?.email ?? "");
            return { ok: true, message: "Linked. ESPG playlist logins now work here; TwentyFourSeven's own logins are kept but stop working." };
          } catch {
            return { ok: false, message: "Saved, but ESPG didn't answer. Check the address and that ESPG is up to date." };
          }
        }),

      setPlaylistName: adminProcedure
        .input(z.object({ playlistName: z.string().trim().min(1).max(40) }))
        .handler(async ({ input }) => {
          await prisma.settings.upsert({
            where: { id: "singleton" },
            create: { id: "singleton", playlistName: input.playlistName },
            update: { playlistName: input.playlistName },
          });
          return { ok: true, message: "Saved. Only new and reset logins use the new name." };
        }),

      espg: adminProcedure.handler(async () => {
        const settings = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { espgUrl: true } });
        const { espgConfigured } = await import('../lib/playlist-login');
        const current = await espgConfigured();
        return {
          espgUrl: settings?.espgUrl ?? "",
          fromEnv: !settings?.espgUrl && !!process.env.ESPG_URL,
          active: !!current,
          hasWatchTowerToken: current?.hasToken ?? false,
        };
      }),

      setEspg: adminProcedure
        .input(z.object({ espgUrl: z.string().trim().max(300) }))
        .handler(async ({ input, context }) => {
          const url = input.espgUrl.replace(/\/+$/, "");
          if (url && !/^https?:\/\/[^\s/]+/i.test(url)) {
            throw new ORPCError("BAD_REQUEST", { message: "Enter the ESPG address, like http://192.168.1.10:9191" });
          }
          const pl = await import('../lib/playlist-login');
          const before = await pl.loginSettings();
          // Saving an address must not quietly change the mode. Before anyone chose a mode,
          // pin the one in use now so the upgrade guess can't flip.
          const pin = before.savedMode === "tfs" || before.savedMode === "espg" ? {} : { playlistLoginMode: before.mode };
          await prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton", espgUrl: url, ...pin }, update: { espgUrl: url, ...pin } });
          pl.clearEspgLinkCache();
          pl.clearLoginCache();
          const s = await pl.loginSettings();
          if (s.mode !== "espg") return { ok: true, message: "ESPG address saved. Playlist logins are kept by TwentyFourSeven (switch to “Linked to ESPG” to use ESPG logins)." };
          if (!s.espgUrl) return { ok: false, message: new pl.LinkedWithoutAddressError().message };
          if (!s.hasToken) return { ok: false, message: new pl.LinkedWithoutTokenError().message };
          try {
            await pl.playlistLogins.lookup(context.session?.user?.email ?? "");
            return { ok: true, message: "Connected. ESPG playlist logins now work here." };
          } catch {
            return { ok: false, message: "Saved, but ESPG didn't answer. Check the address and that ESPG is up to date." };
          }
        }),

      /** Admin: everyone's playlist login. Editable only when on its own. */
      list: adminProcedure.handler(async () => {
        const pl = await import('../lib/playlist-login');
        const { openSealedLogin } = await import('../lib/link-security');
        const s = await pl.loginSettings();
        const users = await prisma.user.findMany({
          select: { id: true, name: true, email: true, firstName: true, lastName: true, role: true },
          orderBy: { name: "asc" },
        });
        const rows = await prisma.playlistLogin.findMany();
        const byUser = new Map(rows.map((r) => [r.userId, r]));
        return {
          mode: s.mode,
          readOnly: s.mode !== "tfs",
          playlistName: s.playlistName,
          users: users.map((u) => {
            const r = byUser.get(u.id);
            const opened = r ? openSealedLogin(r.passwordSealed) : null;
            return {
              userId: u.id,
              name: u.name,
              email: u.email,
              firstName: u.firstName ?? "",
              lastName: u.lastName ?? "",
              login: r
                ? { username: opened?.username ?? r.username, password: opened?.password ?? null, custom: r.custom, origin: r.origin, updatedAt: r.updatedAt, maxStreams: r.maxStreams }
                : null,
            };
          }),
        };
      }),

      adminSet: adminProcedure
        .input(
          z.object({
            userId: z.string().min(1),
            username: z.string().trim().min(3).max(50).regex(/^[^\s/:@?#&%]+$/, "No spaces or / : @ ? # & %"),
            password: z.string().min(4).max(100).regex(/^[^\s/:@?#&%]+$/, "No spaces or / : @ ? # & %"),
          }),
        )
        .handler(async ({ input }) => {
          const pl = await import('../lib/playlist-login');
          const { sealLogin } = await import('../lib/link-security');
          const s = await pl.loginSettings();
          if (s.mode !== "tfs") throw new ORPCError("BAD_REQUEST", { message: "Playlist logins come from ESPG. Edit them in ESPG (Users → playlist login)." });
          const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
          if (!user) throw new ORPCError("NOT_FOUND", { message: "No such user." });
          const others = await prisma.playlistLogin.findMany({ where: { NOT: { userId: input.userId } }, select: { username: true } });
          if (others.some((o) => o.username.toLowerCase() === input.username.toLowerCase())) {
            throw new ORPCError("CONFLICT", { message: "Someone else already uses that username." });
          }
          const passwordSealed = sealLogin({ username: input.username, password: input.password });
          await prisma.playlistLogin.upsert({
            where: { userId: input.userId },
            create: { userId: input.userId, username: input.username, passwordSealed, custom: true, origin: "custom" },
            update: { username: input.username, passwordSealed, custom: true, origin: "custom" },
          });
          pl.clearLoginCache();
          return { ok: true };
        }),

      adminReset: adminProcedure
        .input(z.object({ userId: z.string().min(1) }))
        .handler(async ({ input }) => {
          const pl = await import('../lib/playlist-login');
          const s = await pl.loginSettings();
          if (s.mode !== "tfs") throw new ORPCError("BAD_REQUEST", { message: "Playlist logins come from ESPG. Reset them in ESPG." });
          const login = await pl.makeDefaultLoginFor(input.userId);
          return { ok: true, username: login.username };
        }),

      adminSetStreamLimit: adminProcedure
        .input(z.object({ userId: z.string().min(1), maxStreams: z.number().int().min(0).max(50) }))
        .handler(async ({ input }) => {
          const pl = await import('../lib/playlist-login');
          const s = await pl.loginSettings();
          if (s.mode !== "tfs") throw new ORPCError("BAD_REQUEST", { message: "Linked to ESPG: the 24/7 limit is each person's ESPG TV connections + 1." });
          const row = await prisma.playlistLogin.findUnique({ where: { userId: input.userId }, select: { id: true } });
          if (!row) throw new ORPCError("NOT_FOUND", { message: "Make a playlist login for this person first." });
          await prisma.playlistLogin.update({ where: { userId: input.userId }, data: { maxStreams: input.maxStreams } });
          return { ok: true };
        }),

      adminSetNames: adminProcedure
        .input(z.object({ userId: z.string().min(1), firstName: z.string().trim().max(60), lastName: z.string().trim().max(60) }))
        .handler(async ({ input }) => {
          await prisma.user.update({
            where: { id: input.userId },
            data: { firstName: input.firstName || null, lastName: input.lastName || null },
          });
          return { ok: true, message: "Names saved. Reset the login to use them." };
        }),
    },

    ffmpeg: {
      get: adminProcedure.handler(async () => {
        let ffmpegSettings = await prisma.ffmpegSettings.findUnique({
          where: { id: "singleton" }
        });

        if (!ffmpegSettings) {
          // Ensure main settings exist first
          await prisma.settings.upsert({
            where: { id: "singleton" },
            create: { id: "singleton" },
            update: {}
          });

          ffmpegSettings = await prisma.ffmpegSettings.create({
            data: { 
              id: "singleton",
              settingsId: "singleton"
            }
          });
        }

        return ffmpegSettings;
      }),

      update: adminProcedure
        .input(z.object({
          ffmpegPath: z.string().optional(),
          ffprobePath: z.string().optional(),
          pathLocked: z.boolean().optional(),
          autoDetectPath: z.boolean().optional(),
          enableTranscoding: z.boolean().optional(),
          targetResolution: z.string().optional(),
          videoBitrate: z.string().optional(),
          videoBufSize: z.string().optional(),
          videoCodec: z.string().optional(),
          audioCodec: z.string().optional(),
          audioSampleRate: z.number().optional(),
          audioBitrate: z.string().optional(),
          audioChannels: z.number().optional(),
          enableHardwareAccel: z.boolean().optional(),
          hardwareAccelType: z.string().optional(),
          hardwareDevice: z.string().optional(),
          videoPreset: z.string().optional(),
          videoCrf: z.number().optional(),
          maxMuxingQueueSize: z.number().optional(),
          threads: z.number().optional(),
          outputFormat: z.string().optional(),
          segmentTime: z.number().optional(),
          segmentListSize: z.number().optional(),
          errorScreen: z.string().optional(),
          errorAudio: z.string().optional(),
          logLevel: z.string().optional(),
          enableStats: z.boolean().optional(),
          statsFilePath: z.string().optional(),
          globalOptions: z.string().optional(),
          inputOptions: z.string().optional(),
          outputOptions: z.string().optional()
        }))
        .handler(async ({ input }) => {
          // Ensure main settings exist first
          await prisma.settings.upsert({
            where: { id: "singleton" },
            create: { id: "singleton" },
            update: {}
          });

          return await prisma.ffmpegSettings.upsert({
            where: { id: "singleton" },
            create: { 
              id: "singleton",
              settingsId: "singleton",
              ...input 
            },
            update: input
          });
        }),

      // System information endpoints
      systemInfo: adminProcedure.handler(async () => {
        const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
        return await ffmpegService.getSystemInfo();
      }),

      detectPaths: adminProcedure.handler(async () => {
        const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
        return await ffmpegService.detectFfmpegPath();
      }),

      validatePath: adminProcedure
        .input(z.object({ path: z.string() }))
        .handler(async ({ input }) => {
          const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
          return await ffmpegService.validateFfmpegPath(input.path);
        }),

      getInfo: adminProcedure
        .input(z.object({ path: z.string().optional() }))
        .handler(async ({ input }) => {
          const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
          return await ffmpegService.getFfmpegInfo(input.path);
        }),

      testHardwareAccel: adminProcedure
        .input(z.object({ 
          type: z.string(),
          device: z.string().optional(),
          ffmpegPath: z.string().optional()
        }))
        .handler(async ({ input }) => {
          const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
          return await ffmpegService.testHardwareAcceleration(
            input.type, 
            input.device, 
            input.ffmpegPath
          );
        }),

      getRecommendedSettings: adminProcedure.handler(async () => {
        const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
        return await ffmpegService.getRecommendedSettings();
      })
    },

    plex: {
      get: adminProcedure.handler(async () => {
        let plexSettings = await prisma.plexSettings.findUnique({
          where: { id: "singleton" }
        });

        if (!plexSettings) {
          // Ensure main settings exist first
          await prisma.settings.upsert({
            where: { id: "singleton" },
            create: { id: "singleton" },
            update: {}
          });

          plexSettings = await prisma.plexSettings.create({
            data: { 
              id: "singleton",
              settingsId: "singleton"
            }
          });
        }

        return plexSettings;
      }),

      update: adminProcedure
        .input(z.object({
          autoRefreshLibraries: z.boolean().optional(),
          refreshInterval: z.number().optional(),
          webhookEnabled: z.boolean().optional(),
          connectionTimeout: z.number().optional(),
          requestTimeout: z.number().optional()
        }))
        .handler(async ({ input }) => {
          // Ensure main settings exist first
          await prisma.settings.upsert({
            where: { id: "singleton" },
            create: { id: "singleton" },
            update: {}
          });

          const updatedSettings = await prisma.plexSettings.upsert({
            where: { id: "singleton" },
            create: { 
              id: "singleton",
              settingsId: "singleton",
              ...input 
            },
            update: input
          });

          // Update sync schedules if auto-refresh settings changed
          if (input.autoRefreshLibraries !== undefined || input.refreshInterval !== undefined) {
            try {
              const { StartupService } = await import('../lib/startup');
              
              // Get all Plex servers
              const plexServers = await prisma.mediaServer.findMany({
                where: {
                  type: 'PLEX',
                  active: true
                }
              });

              // Update sync schedule for each server
              for (const server of plexServers) {
                StartupService.updateServerSyncSchedule(
                  server.id, 
                  updatedSettings.autoRefreshLibraries,
                  updatedSettings.refreshInterval
                );
              }
            } catch (error) {
              
            }
          }

          return updatedSettings;
        }),

      /** The secret for the Plex webhook URL (admin only; Plex needs the full URL pasted in). */
      webhookAccess: adminProcedure.handler(async () => {
        const { getPlexWebhookStatus, prismaPlexWebhookStore } = await import('../lib/plex-webhook-token');
        return getPlexWebhookStatus(prismaPlexWebhookStore());
      }),

      regenerateWebhookToken: adminProcedure.handler(async () => {
        const { regeneratePlexWebhookToken, prismaPlexWebhookStore } = await import('../lib/plex-webhook-token');
        return regeneratePlexWebhookToken(prismaPlexWebhookStore());
      })
    },

    webhooks: {
      getActivity: adminProcedure
        .input(z.object({
          limit: z.number().default(50),
          offset: z.number().default(0),
          source: z.string().optional(),
          status: z.string().optional()
        }))
        .handler(async ({ input }) => {
          const where: any = {};
          
          if (input.source) {
            where.source = input.source;
          }
          
          if (input.status) {
            where.status = input.status;
          }
          
          const [activities, total] = await Promise.all([
            prisma.webhookActivity.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              take: input.limit,
              skip: input.offset
            }),
            prisma.webhookActivity.count({ where })
          ]);
          
          return {
            activities,
            total,
            hasMore: input.offset + input.limit < total
          };
        }),
        
      getStats: adminProcedure.handler(async () => {
        const stats = await Promise.all([
          prisma.webhookActivity.count(),
          prisma.webhookActivity.count({ where: { status: 'processed' } }),
          prisma.webhookActivity.count({ where: { status: 'failed' } }),
          prisma.webhookActivity.count({ 
            where: { 
              createdAt: { 
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000) 
              }
            }
          })
        ]);
        
        return {
          total: stats[0],
          processed: stats[1],
          failed: stats[2],
          last24Hours: stats[3]
        };
      }),
      
      clearActivity: adminProcedure
        .input(z.object({
          olderThanDays: z.number().default(7)
        }))
        .handler(async ({ input }) => {
          const cutoffDate = new Date(Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000);
          
          const result = await prisma.webhookActivity.deleteMany({
            where: {
              createdAt: { lt: cutoffDate }
            }
          });
          
          return {
            deleted: result.count,
            message: `Deleted ${result.count} webhook activities older than ${input.olderThanDays} days`
          };
        })
    }
  },

  // Streaming endpoints (these would normally handle video streaming)
  stream: {
    channel: publicProcedure
      .input(z.object({ channelNumber: z.number() }))
      .handler(async ({ input }) => {
        // This would normally return streaming URL or handle HLS/DASH
        const channel = await prisma.channel.findUnique({
          where: { number: input.channelNumber }
        });
        
        if (!channel) {
          throw new Error(`Channel ${input.channelNumber} not found`);
        }
        
        return {
          url: `/stream/channel/${input.channelNumber}.m3u8`,
          channel
        };
      }),

    m3u: publicProcedure.handler(async () => {
      const channels = await prisma.channel.findMany({
        where: { stealth: false },
        orderBy: { number: 'asc' }
      });

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      
      let m3u = '#EXTM3U\n';
      for (const channel of channels) {
        m3u += `#EXTINF:-1 tvg-id="${channel.number}" tvg-name="${channel.name}"`;
        if (channel.groupTitle) {
          m3u += ` group-title="${channel.groupTitle}"`;
        }
        if (channel.icon) {
          m3u += ` tvg-logo="${channel.icon}"`;
        }
        m3u += `,${channel.name}\n`;
        m3u += `${baseUrl}/stream/channel/${channel.number}\n`;
      }

      return m3u;
    }),

    xmltv: publicProcedure.handler(async () => {
      // Redirect to the actual XMLTV API endpoint which has full implementation
      // This ensures consistency between router and API endpoints
      return 'Please use /media.xml endpoint for complete XMLTV guide data';
    }),

    validate: adminProcedure.handler(async () => {
      const { XmltvValidator } = await import('../lib/xmltv-validator');
      const report = await XmltvValidator.generateValidationReport();
      const consistency = await XmltvValidator.validateXmltvConsistency();
      
      return {
        report,
        isValid: consistency.isValid,
        stats: consistency.stats,
        errors: consistency.errors,
        warnings: consistency.warnings
      };
    })
  },

  viewers: {
    getActive: adminProcedure.handler(async ({ context }) => {
      await requireAdminAsync(context.session?.user?.id, prisma);
      return await viewingHistoryService.getActiveViewers();
    }),

    getHistory: adminProcedure
      .input(
        z.object({
          ipAddress: z.string().optional(),
          viewerName: z.string().optional(),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          channelNumber: z.number().optional(),
          limit: z.number().optional().default(50),
          offset: z.number().optional().default(0),
        })
      )
      .handler(async ({ input, context }) => {
        await requireAdminAsync(context.session?.user?.id, prisma);
        return await viewingHistoryService.getViewingHistory(input);
      }),

    getViewingSessions: adminProcedure
      .input(
        z.object({
          ipAddress: z.string().optional(),
          viewerName: z.string().optional(),
          startDate: z.date().optional(),
          endDate: z.date().optional(),
          channelNumber: z.number().optional(),
          limit: z.number().optional().default(50),
          offset: z.number().optional().default(0),
        })
      )
      .handler(async ({ input, context }) => {
        await requireAdminAsync(context.session?.user?.id, prisma);
        return await viewingHistoryService.getViewingSessions(input);
      }),

    listMappings: adminProcedure.handler(async ({ context }) => {
      await requireAdminAsync(context.session?.user?.id, prisma);
      return await prisma.viewer.findMany({
        orderBy: { createdAt: 'desc' },
      });
    }),

    createMapping: adminProcedure
      .input(
        z.object({
          ipAddress: z.string(),
          name: z.string(),
          notes: z.string().optional(),
          userId: z.string().optional(),
          blocked: z.boolean().optional(),
        })
      )
      .handler(async ({ input, context }) => {
        await requireAdminAsync(context.session?.user?.id, prisma);

        // Clear cache when creating/updating mapping
        viewingHistoryService.clearCache();

        return await viewingHistoryService.createIpMapping(input);
      }),

    blockIp: adminProcedure
      .input(
        z.object({
          ipAddress: z.string(),
        })
      )
      .handler(async ({ input, context }) => {
        await requireAdminAsync(context.session?.user?.id, prisma);
        viewingHistoryService.clearCache();
        return await viewingHistoryService.blockIp(input.ipAddress);
      }),

    unblockIp: adminProcedure
      .input(
        z.object({
          ipAddress: z.string(),
        })
      )
      .handler(async ({ input, context }) => {
        await requireAdminAsync(context.session?.user?.id, prisma);
        viewingHistoryService.clearCache();
        return await viewingHistoryService.unblockIp(input.ipAddress);
      }),

    assignIpToUser: adminProcedure
      .input(
        z.object({
          ipAddress: z.string(),
          userId: z.string(),
        })
      )
      .handler(async ({ input, context }) => {
        await requireAdminAsync(context.session?.user?.id, prisma);
        viewingHistoryService.clearCache();
        return await viewingHistoryService.assignIpToUser(input.ipAddress, input.userId);
      }),

    getUsers: adminProcedure.handler(async ({ context }) => {
      await requireAdminAsync(context.session?.user?.id, prisma);
      return await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
        },
        orderBy: { name: 'asc' },
      });
    }),

    getUnassignedIps: adminProcedure.handler(async ({ context }) => {
      await requireAdminAsync(context.session?.user?.id, prisma);
      
      // Get all unique IP addresses from viewing history using groupBy
      const historyGroups = await prisma.viewingHistory.groupBy({
        by: ['ipAddress'],
      });
      
      // Get all IP addresses that already have mappings
      const mappedIps = await prisma.viewer.findMany({
        select: { ipAddress: true },
      });
      
      const mappedIpSet = new Set(mappedIps.map(v => v.ipAddress));
      const unassignedIps = historyGroups
        .map(g => g.ipAddress)
        .filter(ip => !mappedIpSet.has(ip))
        .sort();
      
      return unassignedIps;
    }),

    deleteMapping: adminProcedure
      .input(
        z.object({
          id: z.string().optional(),
          ipAddress: z.string().optional(),
        })
      )
      .handler(async ({ input, context }) => {
        await requireAdminAsync(context.session?.user?.id, prisma);
        
        const where = input.id 
          ? { id: input.id }
          : input.ipAddress 
          ? { ipAddress: input.ipAddress }
          : null;
        
        if (!where) {
          throw new Error('Either id or ipAddress must be provided');
        }
        
        // Clear cache when deleting mapping
        viewingHistoryService.clearCache();
        
        await prisma.viewer.delete({
          where,
        });
        
        return { success: true };
      }),
  }
};

export type AppRouter = typeof appRouter;
