import { prisma } from '@/lib/prisma';
import type { Channel, MediaMovie, MediaShow } from '../../prisma/generated';

export class ChannelAutomationService {
  /**
   * Check all channels with automation enabled and apply filters to new content
   */
  async processAutomatedChannels(): Promise<void> {
    const automatedChannels = await prisma.channel.findMany({
      where: {
        autoFilterEnabled: true
      },
      include: {
        channelMovies: {
          include: {
            movie: true
          }
        },
        channelShows: {
          include: {
            show: true
          }
        }
      }
    });

    for (const channel of automatedChannels) {
      await this.processChannelAutomation(channel);
    }
  }

  /**
   * Process automation for a specific channel
   */
  async processChannelAutomation(channel: any): Promise<void> {
    try {
      // If this channel is configured for single-show automation, we don't need the heavy
      // filtering logic for movies – only shows matter.
      const singleShowMode = this.isSingleAutomatedShow(channel);

      const { filterType } = channel;

      // Process movies if enabled
      if (!singleShowMode && (filterType === 'movies' || filterType === 'both')) {
        await this.processMovieAutomation(channel);
      }

      // Process shows if enabled
      if (filterType === 'shows' || filterType === 'both') {
        await this.processShowAutomation(channel);
      }

      // Update last scan time
      await prisma.channel.update({
        where: { id: channel.id },
        data: { lastAutoScanAt: new Date() }
      });

    } catch (error) {
      console.error(`Error processing automation for channel ${channel.id}:`, error);
    }
  }

  /**
   * Returns true when the channel contains exactly ONE show, zero movies, and that
   * show has `autoAddNewEpisodes` enabled. Only then can we treat the channel as a
   * "single-show automation" channel.
   */
  private isSingleAutomatedShow(channel: any): boolean {
    return (
      channel.channelMovies.length === 0 &&
      channel.channelShows.length === 1 &&
      channel.channelShows[0].autoAddNewEpisodes === true
    );
  }

  /**
   * Process movie automation for a channel
   */
  private async processMovieAutomation(channel: any): Promise<void> {
    // Get all movies that match the filter criteria
    const matchingMovies = await this.getMatchingMovies(channel);

    // Get movies already in the channel
    const existingMovieIds = new Set(
      channel.channelMovies.map((cm: any) => cm.movieId)
    );

    // Add new matching movies to the channel
    for (const movie of matchingMovies) {
      if (!existingMovieIds.has(movie.id)) {
        await this.addMovieToChannel(channel.id, movie.id);
        console.log(`Auto-added movie "${movie.title}" to channel "${channel.name}"`);
      }
    }
  }

  /**
   * Process show automation for a channel
   */
  private async processShowAutomation(channel: any): Promise<void> {
    // If channel is single-show mode and franchiseAutomation is OFF, nothing to do –
    // episodes for that show come in automatically via the Show → Episode relation.
    const singleShowMode = this.isSingleAutomatedShow(channel);

    if (singleShowMode && !channel.franchiseAutomation) {
      return;
    }

    // Otherwise collect candidate shows (franchise or generic filters)
    const matchingShows = await this.getMatchingShows(channel);

    // Filter out shows already present on the channel
    const existingShowIds = new Set(channel.channelShows.map((cs: any) => cs.showId));

    for (const show of matchingShows) {
      if (!existingShowIds.has(show.id)) {
        await this.addShowToChannel(channel.id, show.id);
        console.log(`Auto-added show "${show.title}" to channel "${channel.name}"`);
      }
    }
  }

  /**
   * Get movies that match the channel's filter criteria
   */
  private async getMatchingMovies(channel: any): Promise<MediaMovie[]> {
    const whereClause: any = {};

    // Year range filter
    if (channel.filterYearStart || channel.filterYearEnd) {
      whereClause.year = {};
      if (channel.filterYearStart) {
        whereClause.year.gte = channel.filterYearStart;
      }
      if (channel.filterYearEnd) {
        whereClause.year.lte = channel.filterYearEnd;
      }
    }

    // Content rating filter
    if (channel.filterRating) {
      whereClause.contentRating = channel.filterRating;
    }

    // Studio filter
    if (channel.filterStudios) {
      const studios = JSON.parse(channel.filterStudios);
      if (studios.length > 0) {
        whereClause.OR = studios.map((studio: string) => ({
          studio: {
            contains: studio,
            mode: 'insensitive'
          }
        }));
      }
    }

    const movies = await prisma.mediaMovie.findMany({
      where: whereClause
    });

    // Apply additional filters that require JSON parsing
    return movies.filter(movie => {
      return this.matchesFilters(movie, channel);
    });
  }

  /**
   * Get shows that match the channel's filter criteria
   */
  private async getMatchingShows(channel: any): Promise<MediaShow[]> {
    // If franchiseAutomation is requested and we have a reference show, derive matches
    if (channel.franchiseAutomation && channel.channelShows.length > 0) {
      const baseShow = channel.channelShows[0].show;

      if (baseShow) {
        const keyword = baseShow.title.split(" ")[0]; // naive first-word heuristic

        const franchiseCandidates = await prisma.mediaShow.findMany({
          where: {
            title: { contains: keyword, mode: 'insensitive' }
          } as any // cast for query mode typing compatibility
        });

        return franchiseCandidates;
      }
    }

    // Fallback to generic filter pipeline (existing logic)
    const whereClause: any = {};

    // Year range filter
    if (channel.filterYearStart || channel.filterYearEnd) {
      whereClause.year = {};
      if (channel.filterYearStart) {
        whereClause.year.gte = channel.filterYearStart;
      }
      if (channel.filterYearEnd) {
        whereClause.year.lte = channel.filterYearEnd;
      }
    }

    // Content rating filter
    if (channel.filterRating) {
      whereClause.contentRating = channel.filterRating;
    }

    // Studio filter
    if (channel.filterStudios) {
      const studios = JSON.parse(channel.filterStudios);
      if (studios.length > 0) {
        whereClause.OR = studios.map((studio: string) => ({
          studio: {
            contains: studio,
            mode: 'insensitive'
          }
        }));
      }
    }

    const shows = await prisma.mediaShow.findMany({
      where: whereClause
    });

    // Apply additional filters that require JSON parsing
    const filtered = shows.filter(show => this.matchesFilters(show, channel));

    // When franchiseAutomation is ON we may have duplicate entries; ensure uniqueness.
    return Array.from(new Map(filtered.map(s => [s.id, s])).values());
  }

  /**
   * Check if a media item matches the channel's filter criteria
   */
  private matchesFilters(media: MediaMovie | MediaShow, channel: any): boolean {
    // Genre filter
    if (channel.filterGenres) {
      const filterGenres = JSON.parse(channel.filterGenres);
      if (filterGenres.length > 0 && media.genres) {
        const mediaGenres = JSON.parse(media.genres);
        const hasMatchingGenre = filterGenres.some((filterGenre: string) =>
          mediaGenres.some((genre: string) =>
            genre.toLowerCase().includes(filterGenre.toLowerCase())
          )
        );
        if (!hasMatchingGenre) return false;
      }
    }

    // Actor filter
    if (channel.filterActors) {
      const filterActors = JSON.parse(channel.filterActors);
      if (filterActors.length > 0 && media.actors) {
        const mediaActors = JSON.parse(media.actors);
        const hasMatchingActor = filterActors.some((filterActor: string) =>
          mediaActors.some((actor: string) =>
            actor.toLowerCase().includes(filterActor.toLowerCase())
          )
        );
        if (!hasMatchingActor) return false;
      }
    }

    // Director filter
    if (channel.filterDirectors) {
      const filterDirectors = JSON.parse(channel.filterDirectors);
      if (filterDirectors.length > 0 && media.directors) {
        const mediaDirectors = JSON.parse(media.directors);
        const hasMatchingDirector = filterDirectors.some((filterDirector: string) =>
          mediaDirectors.some((director: string) =>
            director.toLowerCase().includes(filterDirector.toLowerCase())
          )
        );
        if (!hasMatchingDirector) return false;
      }
    }

    return true;
  }

  /**
   * Apply auto-sort method to channel content
   */
  private async applySortMethod(channelId: string, sortMethod: string): Promise<void> {
    if (!sortMethod || sortMethod.trim() === '') {
      return;
    }

    try {
      // Get all content for the channel
      const [channelMovies, channelShows] = await Promise.all([
        prisma.channelMovie.findMany({
          where: { channelId },
          include: { movie: true }
        }),
        prisma.channelShow.findMany({
          where: { channelId },
          include: { show: true }
        })
      ]);

      // Combine and sort all content with additional metadata
      const allContent = [
        ...channelMovies.map(cm => ({ 
          ...cm, 
          type: 'movie', 
          title: cm.movie.title, 
          year: cm.movie.year,
          duration: cm.movie.duration || 0
        })),
        ...channelShows.map(cs => ({ 
          ...cs, 
          type: 'show', 
          title: cs.show.title, 
          year: cs.show.year,
          duration: 0 // Shows don't have a single duration
        }))
      ];

      // Apply sorting logic
      switch (sortMethod) {
        case 'sort-title-asc':
        case 'title-asc':
          allContent.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'sort-title-desc':
        case 'title-desc':
          allContent.sort((a, b) => b.title.localeCompare(a.title));
          break;
        case 'sort-year-newest':
        case 'year-newest':
          allContent.sort((a, b) => (b.year || 0) - (a.year || 0));
          break;
        case 'sort-year-oldest':
        case 'year-oldest':
          allContent.sort((a, b) => (a.year || 0) - (b.year || 0));
          break;
        case 'sort-duration-longest':
          allContent.sort((a, b) => (b.duration || 0) - (a.duration || 0));
          break;
        case 'sort-duration-shortest':
          allContent.sort((a, b) => (a.duration || 0) - (b.duration || 0));
          break;
        case 'sort-episode-title-asc':
          // For shows, sort by show title; for movies, sort by movie title
          allContent.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'sort-episode-title-desc':
          allContent.sort((a, b) => b.title.localeCompare(a.title));
          break;
        case 'sort-season-episode':
          // Sort shows first, then movies, all by title
          allContent.sort((a, b) => {
            if (a.type !== b.type) {
              return a.type === 'show' ? -1 : 1; // Shows first
            }
            return a.title.localeCompare(b.title);
          });
          break;
        default:
          return; // Unknown sort method
      }

      // Update order for all content
      const updatePromises = allContent.map((item, index) => {
        if (item.type === 'movie') {
          return prisma.channelMovie.update({
            where: { id: item.id },
            data: { order: index }
          });
        } else {
          return prisma.channelShow.update({
            where: { id: item.id },
            data: { order: index }
          });
        }
      });

      await Promise.all(updatePromises);
    } catch (error) {
      console.error(`Error applying sort method ${sortMethod} to channel ${channelId}:`, error);
    }
  }

  /**
   * Add a movie to a channel
   */
  private async addMovieToChannel(channelId: string, movieId: string): Promise<void> {
    try {
      // Get channel settings to apply reorder options
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: {
          defaultEpisodeOrder: true,
          respectEpisodeOrder: true,
          blockShuffle: true,
          blockShuffleSize: true,
          autoSortMethod: true
        }
      });

      // Get the next order number for proper positioning
      const lastMovie = await prisma.channelMovie.findFirst({
        where: { channelId },
        orderBy: { order: 'desc' },
        select: { order: true }
      });

      const nextOrder = (lastMovie?.order ?? -1) + 1;

      await prisma.channelMovie.create({
        data: {
          channelId,
          movieId,
          order: nextOrder,
          // Apply channel's reorder settings to new content
          shuffle: channel?.defaultEpisodeOrder === 'shuffle' || channel?.defaultEpisodeOrder === 'random',
          maxConsecutiveMovies: 0 // Default, can be customized later
        }
      });

      // Apply auto-sort method if configured
      if (channel?.autoSortMethod) {
        await this.applySortMethod(channelId, channel.autoSortMethod);
      }

      // Auto-generate programs for this channel
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.generateProgramsForChannel(channelId);
    } catch (error) {
      console.error(`Error adding movie ${movieId} to channel ${channelId}:`, error);
    }
  }

  /**
   * Add a show to a channel
   */
  private async addShowToChannel(channelId: string, showId: string): Promise<void> {
    try {
      // Get channel settings to apply reorder options
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: {
          defaultEpisodeOrder: true,
          respectEpisodeOrder: true,
          blockShuffle: true,
          blockShuffleSize: true,
          autoSortMethod: true
        }
      });

      // Get the next order number for proper positioning
      const lastShow = await prisma.channelShow.findFirst({
        where: { channelId },
        orderBy: { order: 'desc' },
        select: { order: true }
      });

      const nextOrder = (lastShow?.order ?? -1) + 1;

      await prisma.channelShow.create({
        data: {
          channelId,
          showId,
          order: nextOrder,
          // Apply channel's reorder settings to new content
          shuffle: channel?.defaultEpisodeOrder === 'shuffle' || channel?.defaultEpisodeOrder === 'random',
          respectOrder: channel?.respectEpisodeOrder ?? true,
          blockShuffle: channel?.blockShuffle ?? false,
          blockShuffleSize: channel?.blockShuffleSize ?? 1,
          maxConsecutiveEpisodes: 0 // Default, can be customized later
        }
      });

      // Apply auto-sort method if configured
      if (channel?.autoSortMethod) {
        await this.applySortMethod(channelId, channel.autoSortMethod);
      }

      // Auto-generate programs for this channel
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.generateProgramsForChannel(channelId);
    } catch (error) {
      console.error(`Error adding show ${showId} to channel ${channelId}:`, error);
    }
  }

  /**
   * Process automation for a specific channel by ID
   */
  async processChannelById(channelId: string): Promise<void> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        channelMovies: {
          include: {
            movie: true
          }
        },
        channelShows: {
          include: {
            show: true
          }
        }
      }
    });

    if (channel && channel.autoFilterEnabled) {
      await this.processChannelAutomation(channel);
    }
  }

  /**
   * Update channel filters and process automation immediately
   */
  async updateChannelFilters(channelId: string, filters: any): Promise<void> {
    await prisma.channel.update({
      where: { id: channelId },
      data: {
        ...filters,
        lastAutoScanAt: new Date()
      }
    });

    // Process automation immediately if enabled
    if (filters.autoFilterEnabled) {
      await this.processChannelById(channelId);
    }
  }
}

export const channelAutomationService = new ChannelAutomationService(); 