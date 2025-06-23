import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../lib/orpc";
import { prisma } from "../lib/prisma";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),

  // Channel Management
  channels: {
    list: publicProcedure.handler(async () => {
      return await prisma.channel.findMany({
        include: {
          programs: {
            include: {
              episode: {
                include: { show: true }
              },
              movie: true
            }
          },
          channelShows: {
            include: { 
              show: {
                include: {
                  episodes: true,
                  _count: {
                    select: { episodes: true }
                  }
                }
              }
            }
          },
          channelMovies: {
            include: { movie: true }
          }
        },
        orderBy: { number: 'asc' }
      });
    }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .handler(async ({ input }) => {
        return await prisma.channel.findUnique({
          where: { id: input.id },
          include: {
            programs: {
              include: {
                episode: {
                  include: { show: true }
                },
                movie: true
              }
            },
            channelShows: {
              include: { 
                show: {
                  include: {
                    episodes: true,
                    _count: {
                      select: { episodes: true }
                    }
                  }
                }
              }
            },
            channelMovies: {
              include: { movie: true }
            }
          }
        });
      }),

    create: protectedProcedure
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

    update: protectedProcedure
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

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .handler(async ({ input }) => {
        return await prisma.channel.delete({
          where: { id: input.id }
        });
      }),

    addShow: protectedProcedure
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
          console.error('Failed to generate programs after adding show:', error);
        }
        
        return result;
      }),

    removeShow: protectedProcedure
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
          console.error('Failed to generate programs after removing show:', error);
        }
        
        return result;
      }),

    addMovie: protectedProcedure
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
          console.error('Failed to generate programs after adding movie:', error);
        }
        
        return result;
      }),

          removeMovie: protectedProcedure
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
          console.error('Failed to generate programs after removing movie:', error);
        }
        
        return result;
      }),

    generatePrograms: protectedProcedure
      .input(z.object({
        channelId: z.string(),
        hours: z.number().default(24)
      }))
      .handler(async ({ input }) => {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForChannel(input.channelId, input.hours);
        return { success: true };
      }),

    updateShowOrder: protectedProcedure
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

    updateMovieOrder: protectedProcedure
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
    processAutomation: protectedProcedure
      .input(z.object({
        channelId: z.string()
      }))
      .handler(async ({ input }) => {
        const { channelAutomationService } = await import('@/lib/channel-automation-service');
        await channelAutomationService.processChannelById(input.channelId);
        return { success: true };
      }),

    processAllAutomation: protectedProcedure
      .handler(async () => {
        const { channelAutomationService } = await import('@/lib/channel-automation-service');
        await channelAutomationService.processAutomatedChannels();
        return { success: true };
      }),

    updateFilters: protectedProcedure
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
        franchiseAutomation: z.boolean().optional()
      }))
      .handler(async ({ input }) => {
        const { id, ...filters } = input;
        const { channelAutomationService } = await import('@/lib/channel-automation-service');
        await channelAutomationService.updateChannelFilters(id, filters);
        return { success: true };
      }),

    // Metadata endpoints for autocomplete
    getActors: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => {
        const { search, limit } = input;
        
        // Get unique actors from both movies and shows
        const [movieActors, showActors] = await Promise.all([
          prisma.mediaMovie.findMany({
            where: {
              actors: {
                not: null
              }
            },
            select: {
              actors: true
            }
          }),
          prisma.mediaShow.findMany({
            where: {
              actors: {
                not: null
              }
            },
            select: {
              actors: true
            }
          })
        ]);

        // Extract and flatten all actors
        const allActors = new Set<string>();
        
        [...movieActors, ...showActors].forEach(item => {
          if (item.actors) {
            try {
              const actors = JSON.parse(item.actors);
              if (Array.isArray(actors)) {
                actors.forEach(actor => {
                  if (typeof actor === 'string' && actor.trim()) {
                    allActors.add(actor.trim());
                  }
                });
              }
            } catch (error) {
              // Skip invalid JSON
            }
          }
        });

        // Convert to array and sort
        let actorList = Array.from(allActors).sort();

        // Apply search filter if provided
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase();
          actorList = actorList.filter(actor => 
            actor.toLowerCase().includes(searchTerm)
          );
        }

        return actorList.slice(0, limit);
      }),

    getDirectors: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => {
        const { search, limit } = input;
        
        // Get unique directors from both movies and shows
        const [movieDirectors, showDirectors] = await Promise.all([
          prisma.mediaMovie.findMany({
            where: {
              directors: {
                not: null
              }
            },
            select: {
              directors: true
            }
          }),
          prisma.mediaShow.findMany({
            where: {
              directors: {
                not: null
              }
            },
            select: {
              directors: true
            }
          })
        ]);

        // Extract and flatten all directors
        const allDirectors = new Set<string>();
        
        [...movieDirectors, ...showDirectors].forEach(item => {
          if (item.directors) {
            try {
              const directors = JSON.parse(item.directors);
              if (Array.isArray(directors)) {
                directors.forEach(director => {
                  if (typeof director === 'string' && director.trim()) {
                    allDirectors.add(director.trim());
                  }
                });
              }
            } catch (error) {
              // Skip invalid JSON
            }
          }
        });

        // Convert to array and sort
        let directorList = Array.from(allDirectors).sort();

        // Apply search filter if provided
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase();
          directorList = directorList.filter(director => 
            director.toLowerCase().includes(searchTerm)
          );
        }

        return directorList.slice(0, limit);
      }),

    getGenres: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => {
        const { search, limit } = input;
        
        // Get unique genres from both movies and shows
        const [movieGenres, showGenres] = await Promise.all([
          prisma.mediaMovie.findMany({
            where: {
              genres: {
                not: null
              }
            },
            select: {
              genres: true
            }
          }),
          prisma.mediaShow.findMany({
            where: {
              genres: {
                not: null
              }
            },
            select: {
              genres: true
            }
          })
        ]);

        // Extract and flatten all genres
        const allGenres = new Set<string>();
        
        [...movieGenres, ...showGenres].forEach(item => {
          if (item.genres) {
            try {
              const genres = JSON.parse(item.genres);
              if (Array.isArray(genres)) {
                genres.forEach(genre => {
                  if (typeof genre === 'string' && genre.trim()) {
                    allGenres.add(genre.trim());
                  }
                });
              }
            } catch (error) {
              // Skip invalid JSON
            }
          }
        });

        // Convert to array and sort
        let genreList = Array.from(allGenres).sort();

        // Apply search filter if provided
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase();
          genreList = genreList.filter(genre => 
            genre.toLowerCase().includes(searchTerm)
          );
        }

        return genreList.slice(0, limit);
      }),

    getStudios: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => {
        const { search, limit } = input;
        
        // Get unique studios from both movies and shows
        const [movieStudios, showStudios] = await Promise.all([
          prisma.mediaMovie.findMany({
            where: {
              studio: {
                not: null
              }
            },
            select: {
              studio: true
            }
          }),
          prisma.mediaShow.findMany({
            where: {
              studio: {
                not: null
              }
            },
            select: {
              studio: true
            }
          })
        ]);

        // Extract and flatten all studios
        const allStudios = new Set<string>();
        
        [...movieStudios, ...showStudios].forEach(item => {
          if (item.studio && item.studio.trim()) {
            allStudios.add(item.studio.trim());
          }
        });

        // Convert to array and sort
        let studioList = Array.from(allStudios).sort();

        // Apply search filter if provided
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase();
          studioList = studioList.filter(studio => 
            studio.toLowerCase().includes(searchTerm)
          );
        }

        return studioList.slice(0, limit);
      }),

    // Collections autocomplete
    getCollections: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        limit: z.number().default(50)
      }))
      .handler(async ({ input }) => {
        const { search, limit } = input;

        // Get collection arrays from movies and shows
        const [movieCollections, showCollections] = await Promise.all([
          prisma.mediaMovie.findMany({
            where: {
              collections: {
                not: null
              }
            },
            select: { collections: true }
          }),
          prisma.mediaShow.findMany({
            where: {
              collections: {
                not: null
              }
            },
            select: { collections: true }
          })
        ]);

        // Flatten unique collection names
        const allCollections = new Set<string>();

        [...movieCollections, ...showCollections].forEach(item => {
          if (item.collections) {
            try {
              const cols = JSON.parse(item.collections);
              if (Array.isArray(cols)) {
                cols.forEach((c: string) => {
                  if (typeof c === 'string' && c.trim()) {
                    allCollections.add(c.trim());
                  }
                });
              }
            } catch (error) {
              // Skip invalid JSON
            }
          }
        });

        // Convert to sorted array
        let collectionList = Array.from(allCollections).sort();

        // Search filter
        if (search && search.trim()) {
          const term = search.toLowerCase();
          collectionList = collectionList.filter(col => col.toLowerCase().includes(term));
        }

        return collectionList.slice(0, limit);
      }),

    reorderContent: protectedProcedure
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
          console.error('Failed to generate programs after reordering content:', error);
        }
        
        return result;
      }),

    reorderEpisodes: protectedProcedure
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
          console.error('Failed to generate programs after reordering episodes:', error);
        }
        
        return result;
      }),

    // Quick Actions
    regenerateSchedule: protectedProcedure
      .input(z.object({ channelId: z.string() }))
      .handler(async ({ input }) => {
        try {
          const { programmingService } = await import('@/lib/programming-service');
          await programmingService.generateProgramsForChannel(input.channelId, 24);
          console.log(`Successfully regenerated schedule for channel: ${input.channelId}`);
          return { success: true, message: "Schedule regenerated successfully" };
        } catch (error) {
          console.error('Failed to regenerate schedule:', error);
          throw new Error(`Failed to regenerate schedule: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),

    shuffleAllContent: protectedProcedure
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
          console.error('Failed to generate programs after shuffling content:', error);
        }
        
        return result;
      }),

    // Programming Rules
    updateChannelSettings: protectedProcedure
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

    updateShowSettings: protectedProcedure
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

    updateMovieSettings: protectedProcedure
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
      })
  },

  // Media Server Management
  servers: {
    list: protectedProcedure.handler(async () => {
      return await prisma.mediaServer.findMany({
        include: {
          libraries: {
            include: {
              shows: { take: 5 },
              movies: { take: 5 }
            }
          }
        }
      });
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string(),
        url: z.string().url(),
        token: z.string().optional(),
        type: z.enum(["PLEX", "JELLYFIN", "EMBY"]).default("PLEX"),
        active: z.boolean().default(true)
      }))
      .handler(async ({ input }) => {
        return await prisma.mediaServer.create({
          data: input
        });
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.string(),
        name: z.string().optional(),
        url: z.string().url().optional(),
        token: z.string().optional(),
        type: z.enum(["PLEX", "JELLYFIN", "EMBY"]).optional(),
        active: z.boolean().optional()
      }))
      .handler(async ({ input }) => {
        const { id, ...data } = input;
        return await prisma.mediaServer.update({
          where: { id },
          data
        });
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .handler(async ({ input }) => {
        return await prisma.mediaServer.delete({
          where: { id: input.id }
        });
      }),

    syncLibraries: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.syncLibraries(input.serverId);
      }),

    testConnection: protectedProcedure
      .input(z.object({
        url: z.string().url(),
        token: z.string()
      }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        const isValid = await PlexService.testConnection(input.url, input.token);
        return { valid: isValid };
      }),

    plexLogin: protectedProcedure
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
        return await PlexService.login(input.username, input.password);
      }),

    addPlexServer: protectedProcedure
      .input(z.object({
        name: z.string(),
        uri: z.string().url(),
        accessToken: z.string(),
        arGuide: z.boolean().optional().default(false),
        arChannels: z.boolean().optional().default(false)
      }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.addPlexServer(input);
      }),

    getServerInfo: protectedProcedure
      .input(z.object({
        url: z.string().url(),
        token: z.string()
      }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.getServerInfo(input.url, input.token);
      }),

    getLibraries: protectedProcedure
      .input(z.object({
        url: z.string().url(),
        token: z.string()
      }))
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
        const { PlexAPI } = await import('../lib/plex');
        const plex = new PlexAPI({ uri: input.url });
        return await plex.getLibraries(input.url, input.token);
      }),

    syncLibrariesFast: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.syncLibraries(input.serverId);
      }),

    updateLibrarySelection: protectedProcedure
      .input(z.object({ 
        serverId: z.string(),
        selectedLibraryKeys: z.array(z.string())
      }))
      .handler(async ({ input }) => {
        const { PlexService } = await import('../lib/plex-service');
        return await PlexService.updateLibrarySelection(input.serverId, input.selectedLibraryKeys);
      })
  },

  // Library Management
  library: {
    debug: publicProcedure.handler(async () => {
      const servers = await prisma.mediaServer.findMany({
        include: {
          libraries: {
            include: {
              shows: true,
              movies: true
            }
          }
        }
      });
      
      const allLibraries = await prisma.mediaLibrary.findMany({
        include: {
          shows: true,
          movies: true,
          server: true
        }
      });
      
      return {
        servers,
        libraries: allLibraries,
        counts: {
          servers: servers.length,
          libraries: allLibraries.length,
          shows: await prisma.mediaShow.count(),
          movies: await prisma.mediaMovie.count()
        }
      };
    }),

    shows: publicProcedure
      .input(z.object({
        libraryId: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0)
      }))
      .handler(async ({ input }) => {
        const where: any = {};
        if (input.libraryId) where.libraryId = input.libraryId;
        if (input.search) {
          where.title = {
            contains: input.search,
            mode: 'insensitive'
          };
        }

        return await prisma.mediaShow.findMany({
          where,
          include: {
            library: true,
            episodes: {
              orderBy: [
                { seasonNumber: 'asc' },
                { episodeNumber: 'asc' }
              ]
            }
          },
          take: input.limit,
          skip: input.offset,
          orderBy: { title: 'asc' }
        });
      }),

    movies: publicProcedure
      .input(z.object({
        libraryId: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0)
      }))
      .handler(async ({ input }) => {
        const where: any = {};
        if (input.libraryId) where.libraryId = input.libraryId;
        if (input.search) {
          where.title = {
            contains: input.search,
            mode: 'insensitive'
          };
        }

        return await prisma.mediaMovie.findMany({
          where,
          include: {
            library: true
          },
          take: input.limit,
          skip: input.offset,
          orderBy: { title: 'asc' }
        });
      }),

    episodes: publicProcedure
      .input(z.object({
        showId: z.string(),
        season: z.number().optional()
      }))
      .handler(async ({ input }) => {
        const where: any = { showId: input.showId };
        if (input.season) where.seasonNumber = input.season;

        return await prisma.mediaEpisode.findMany({
          where,
          include: { show: true },
          orderBy: [
            { seasonNumber: 'asc' },
            { episodeNumber: 'asc' }
          ]
        });
      })
  },

  // Programming/Guide
  guide: {
    current: publicProcedure.handler(async () => {
      // Get guide days setting
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" }
      });
      const guideDays = settings?.guideDays || 3; // Default to 3 days
      
      const now = new Date();
      const endTime = new Date(now.getTime() + guideDays * 24 * 60 * 60 * 1000); // Use guideDays setting

      return await prisma.program.findMany({
        where: {
          startTime: { lte: endTime },
          AND: {
            startTime: { gte: new Date(now.getTime() - 4 * 60 * 60 * 1000) } // Past 4 hours
          }
        },
        include: {
          channel: true,
          episode: {
            include: { show: true }
          },
          movie: true
        },
        orderBy: [
          { channel: { number: 'asc' } },
          { startTime: 'asc' }
        ]
      });
    }),

    channel: publicProcedure
      .input(z.object({
        channelId: z.string(),
        hours: z.number().default(12)
      }))
      .handler(async ({ input }) => {
        const now = new Date();
        const endTime = new Date(now.getTime() + input.hours * 60 * 60 * 1000);

        return await prisma.program.findMany({
          where: {
            channelId: input.channelId,
            startTime: { 
              gte: now,
              lte: endTime 
            }
          },
          include: {
            episode: {
              include: { show: true }
            },
            movie: true
          },
          orderBy: { startTime: 'asc' }
        });
      })
  },

  // Programming Management
  programming: {
    generateForChannel: protectedProcedure
      .input(z.object({
        channelId: z.string(),
        hours: z.number().optional()
      }))
      .handler(async ({ input }) => {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForChannel(input.channelId, input.hours);
        return { success: true };
      }),

    generateForAllChannels: protectedProcedure
      .input(z.object({
        hours: z.number().optional()
      }))
      .handler(async ({ input }) => {
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForAllChannels(input.hours);
        return { success: true };
      }),

    maintain: protectedProcedure.handler(async () => {
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.maintainPrograms();
      return { success: true };
    }),

    cleanup: protectedProcedure.handler(async () => {
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.cleanupOldPrograms();
      return { success: true };
    }),

    cleanupOverlaps: protectedProcedure.handler(async () => {
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

  // Settings Management
  settings: {
        get: publicProcedure.handler(async () => {
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

      return settings;
    }),

    update: protectedProcedure
      .input(z.object({
        port: z.number().optional(),
        ffmpegPath: z.string().optional(), // Temporary for compatibility
        concurrentStreams: z.number().optional(),
        hdhrActive: z.boolean().optional(),
        hdhrDeviceId: z.string().optional(),
        hdhrFriendlyName: z.string().optional(),
        hdhrTunerCount: z.number().optional(),
        guideDays: z.number().optional()
      }))
      .handler(async ({ input }) => {
        return await prisma.settings.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", ...input },
          update: input
        });
      }),

    ffmpeg: {
      get: publicProcedure.handler(async () => {
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

      update: protectedProcedure
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
      systemInfo: publicProcedure.handler(async () => {
        const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
        return await ffmpegService.getSystemInfo();
      }),

      detectPaths: publicProcedure.handler(async () => {
        const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
        return await ffmpegService.detectFfmpegPath();
      }),

      validatePath: publicProcedure
        .input(z.object({ path: z.string() }))
        .handler(async ({ input }) => {
          const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
          return await ffmpegService.validateFfmpegPath(input.path);
        }),

      getInfo: publicProcedure
        .input(z.object({ path: z.string().optional() }))
        .handler(async ({ input }) => {
          const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
          return await ffmpegService.getFfmpegInfo(input.path);
        }),

      testHardwareAccel: publicProcedure
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

      getRecommendedSettings: publicProcedure.handler(async () => {
        const ffmpegService = await import('@/lib/ffmpeg-service').then(m => m.ffmpegService);
        return await ffmpegService.getRecommendedSettings();
      })
    },

    plex: {
      get: publicProcedure.handler(async () => {
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

      update: protectedProcedure
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
              console.error('Failed to update sync schedules:', error);
            }
          }

          return updatedSettings;
        })
    },

    webhooks: {
      getActivity: publicProcedure
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
        
      getStats: publicProcedure.handler(async () => {
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
      
      clearActivity: protectedProcedure
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

    validate: protectedProcedure.handler(async () => {
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
  }
};

export type AppRouter = typeof appRouter;
