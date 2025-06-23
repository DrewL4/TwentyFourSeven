import { prisma } from '@/lib/prisma';
import type { MediaMovie, MediaShow } from '../../prisma/generated';

// Extend the generated Channel model with the eager-loaded relations we use inside the service
export interface ChannelWithRelations {
  id: string;
  name: string;
  filterType: string;
  filterGenres?: string | null;
  filterActors?: string | null;
  filterDirectors?: string | null;
  filterStudios?: string | null;
  filterCollections?: string | null;
  filterYearStart?: number | null;
  filterYearEnd?: number | null;
  filterRating?: string | null;
  franchiseAutomation: boolean;
  channelMovies: Array<{ movieId: string }>;
  channelShows: Array<{ showId: string; show: MediaShow }>;
}

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
  async processChannelAutomation(channel: ChannelWithRelations): Promise<void> {
    try {
      const { filterType } = channel;
      let contentAdded = false;

      // Process movies if enabled
      if (filterType === 'movies' || filterType === 'both') {
        const moviesAdded = await this.processMovieAutomation(channel);
        contentAdded = contentAdded || moviesAdded;
      }

      // Process shows if enabled
      if (filterType === 'shows' || filterType === 'both') {
        const showsAdded = await this.processShowAutomation(channel);
        contentAdded = contentAdded || showsAdded;
      }

      // Update last scan time
      await prisma.channel.update({
        where: { id: channel.id },
        data: { lastAutoScanAt: new Date() }
      });

      // Only regenerate programs if content was actually added
      if (contentAdded) {
        console.log(`Content was added to channel ${channel.name}, regenerating programs`);
        const { programmingService } = await import('@/lib/programming-service');
        await programmingService.generateProgramsForChannel(channel.id);
      }

    } catch (error) {
      console.error(`Error processing automation for channel ${channel.id}:`, error);
      throw error;
    }
  }

  /**
   * Process movie automation for a channel
   */
  private async processMovieAutomation(channel: ChannelWithRelations): Promise<boolean> {
    // Get all movies that match the filter criteria
    const matchingMovies = await this.getMatchingMovies(channel);

    // Get movies already in the channel
    const existingMovieIds = new Set(
      channel.channelMovies.map((cm: { movieId: string }) => cm.movieId)
    );

    let moviesAdded = false;

    // Add new matching movies to the channel
    for (const movie of matchingMovies) {
      if (!existingMovieIds.has(movie.id)) {
        try {
          await this.addMovieToChannel(channel.id, movie.id);
          console.log(`Auto-added movie "${movie.title}" to channel "${channel.name}"`);
          moviesAdded = true;
        } catch (error) {
          console.error(`Error adding movie ${movie.id} to channel ${channel.id}:`, error);
          // Continue with other movies instead of breaking the entire process
        }
      }
    }

    return moviesAdded;
  }

  /**
   * Process show automation for a channel
   */
  private async processShowAutomation(channel: ChannelWithRelations): Promise<boolean> {
    console.log(`Processing show automation for channel "${channel.name}" with filters:`, {
      filterGenres: channel.filterGenres,
      filterActors: channel.filterActors,
      filterDirectors: channel.filterDirectors,
      filterStudios: channel.filterStudios,
      filterYearStart: channel.filterYearStart,
      filterYearEnd: channel.filterYearEnd,
      filterRating: channel.filterRating
    });

    // Get all shows that match the filter criteria
    const matchingShows = await this.getMatchingShows(channel);
    console.log(`Found ${matchingShows.length} shows matching filters for channel "${channel.name}"`);

    // Get shows already in the channel
    const existingShowIds = new Set(
      channel.channelShows.map((cs: { showId: string }) => cs.showId)
    );

    let showsAdded = false;

    // Add new matching shows to the channel
    for (const show of matchingShows) {
      if (!existingShowIds.has(show.id)) {
        try {
          await this.addShowToChannel(channel.id, show.id);
          console.log(`Auto-added show "${show.title}" to channel "${channel.name}"`);
          showsAdded = true;
        } catch (error) {
          console.error(`Error adding show ${show.id} to channel ${channel.id}:`, error);
          // Continue with other shows instead of breaking the entire process
        }
      }
    }

    return showsAdded;
  }

  /**
   * Get movies that match the channel's filter criteria
   */
  private async getMatchingMovies(channel: ChannelWithRelations): Promise<MediaMovie[]> {
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
    return movies.filter((movie: MediaMovie) => {
      return this.matchesFilters(movie, channel);
    });
  }

  /**
   * Get shows that match the channel's filter criteria
   */
  private async getMatchingShows(channel: ChannelWithRelations): Promise<MediaShow[]> {
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

    // Collection filter (handled later in matchesFilters)

    // CONSERVATIVE APPROACH: Only auto-find content if explicit filters are set OR franchise automation is enabled
    const hasExplicitFilters = channel.filterYearStart || channel.filterYearEnd || 
                              channel.filterRating || channel.filterStudios || 
                              channel.filterGenres || channel.filterActors || channel.filterDirectors || channel.filterCollections;

    if (!hasExplicitFilters) {
      // Only look for franchise-related shows if franchise automation is explicitly enabled
      if (channel.franchiseAutomation) {
        console.log(`No explicit filters set for channel "${channel.name}", but franchise automation enabled - looking for franchise content`);
        return await this.findFranchiseRelatedShows(channel.channelShows);
      } else {
        console.log(`No explicit filters set and franchise automation disabled for channel "${channel.name}" - skipping content discovery`);
        return [];
      }
    }

    const shows = await prisma.mediaShow.findMany({
      where: whereClause
    });

    // Apply additional filters that require JSON parsing
    return shows.filter((show: MediaShow) => {
      return this.matchesFilters(show, channel);
    });
  }

  /**
   * Find shows similar to those already in the channel
   */
  private async findSimilarShows(channel: ChannelWithRelations): Promise<MediaShow[]> {
    // Get existing shows in the channel
    const existingShows = channel.channelShows;
    
    if (existingShows.length === 0) {
      console.log(`No existing shows in channel "${channel.name}" to base similarity on`);
      return [];
    }

    // If there's only one show, don't auto-add anything - too risky for false matches
    if (existingShows.length === 1) {
      console.log(`Only one show in channel "${channel.name}", skipping automation to prevent false matches`);
      return [];
    }

    // For channels with multiple shows, try franchise first then similarity
    const franchiseShows = await this.findFranchiseRelatedShows(existingShows);
    if (franchiseShows.length > 0) {
      console.log(`Found ${franchiseShows.length} franchise-related shows for channel "${channel.name}"`);
      return franchiseShows;
    }

    // If no franchise content found, fall back to similarity matching
    console.log(`No franchise content found, using similarity matching for channel "${channel.name}"`);
    const similarityData = await this.extractSimilarityData(existingShows);
    
    if (similarityData.genres.length === 0 && similarityData.actors.length === 0 && similarityData.directors.length === 0) {
      console.log(`No similarity data found for channel "${channel.name}"`);
      return [];
    }

    // Find shows that match the similarity criteria
    const allShows = await prisma.mediaShow.findMany();
    
    return allShows.filter((show: MediaShow) => {
      return this.isSimilarShow(show, similarityData, existingShows);
    }).slice(0, 5); // Limit to 5 similar shows when using fallback method
  }

  /**
   * Find shows that are part of the same franchise/series as existing shows
   */
  private async findFranchiseRelatedShows(existingShows: ChannelWithRelations['channelShows']): Promise<MediaShow[]> {
    const franchiseShows: MediaShow[] = [];
    const existingShowIds = existingShows.map((cs: { showId: string }) => cs.showId);

    for (const channelShow of existingShows) {
      const show = channelShow.show;
      const showTitle = show.title.toLowerCase();

      // Find shows with similar titles (franchise/sequel/prequel patterns)
      const allShows = await prisma.mediaShow.findMany();
      
      const relatedShows = allShows.filter((otherShow: MediaShow) => {
        if (existingShowIds.includes(otherShow.id)) {
          return false; // Skip shows already in channel
        }

        const otherTitle = otherShow.title.toLowerCase();
        
        // Check for franchise relationships
        return this.isFranchiseRelated(showTitle, otherTitle);
      });

      franchiseShows.push(...relatedShows);
    }

    // Remove duplicates
    const uniqueShows = franchiseShows.filter((show, index, self) => 
      index === self.findIndex(s => s.id === show.id)
    );

    return uniqueShows.slice(0, 10); // Limit franchise results
  }

  /**
   * Check if two show titles are franchise-related
   */
  private isFranchiseRelated(title1: string, title2: string): boolean {
    // Remove common words and normalize
    const normalize = (title: string) => title
      .replace(/\(.*?\)/g, '') // Remove years and parenthetical content
      .replace(/[^\w\s]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' ')     // Normalize spaces
      .trim()
      .toLowerCase();

    const norm1 = normalize(title1);
    const norm2 = normalize(title2);

    // Very conservative matching - only exact substring matches with significant overlap
    const getSignificantWords = (title: string) => {
      return title.split(' ').filter(word => 
        word.length > 3 && 
        !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use'].includes(word)
      );
    };

    const words1 = getSignificantWords(norm1);
    const words2 = getSignificantWords(norm2);

    // Need at least 3 significant words in common and high overlap percentage
    const commonWords = words1.filter(word => words2.includes(word));
    const minWords = Math.min(words1.length, words2.length);
    
    // Very strict: need 3+ common words AND 80%+ overlap
    if (commonWords.length >= 3 && commonWords.length >= (minWords * 0.8)) {
      console.log(`Potential franchise match: "${title1}" <-> "${title2}" (${commonWords.length} common words: ${commonWords.join(', ')})`);
      return true;
    }

    return false;
  }

  /**
   * Extract similarity data from existing shows
   */
  private async extractSimilarityData(existingShows: ChannelWithRelations['channelShows']): Promise<{genres: string[], actors: string[], directors: string[]}> {
    const genres = new Set<string>();
    const actors = new Set<string>();
    const directors = new Set<string>();

    for (const channelShow of existingShows) {
      const show = channelShow.show;
      
      // Extract genres
      if (show.genres) {
        try {
          const showGenres = JSON.parse(show.genres);
          showGenres.forEach((genre: string) => genres.add(genre.toLowerCase()));
        } catch (e) {
          // Skip invalid JSON
        }
      }

      // Extract actors
      if (show.actors) {
        try {
          const showActors = JSON.parse(show.actors);
          showActors.forEach((actor: string) => actors.add(actor.toLowerCase()));
        } catch (e) {
          // Skip invalid JSON
        }
      }

      // Extract directors
      if (show.directors) {
        try {
          const showDirectors = JSON.parse(show.directors);
          showDirectors.forEach((director: string) => directors.add(director.toLowerCase()));
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    return {
      genres: Array.from(genres),
      actors: Array.from(actors),
      directors: Array.from(directors)
    };
  }

  /**
   * Check if a show is similar to existing shows in the channel
   */
  private isSimilarShow(show: MediaShow, similarityData: {genres: string[], actors: string[], directors: string[]}, existingShows: ChannelWithRelations['channelShows']): boolean {
    // Don't add shows that are already in the channel
    const existingShowIds = existingShows.map((cs: { showId: string }) => cs.showId);
    if (existingShowIds.includes(show.id)) {
      return false;
    }

    let matchScore = 0;

    // Check genre matches
    if (show.genres && similarityData.genres.length > 0) {
      try {
        const showGenres = JSON.parse(show.genres);
        const genreMatches = showGenres.filter((genre: string) => 
          similarityData.genres.includes(genre.toLowerCase())
        ).length;
        matchScore += genreMatches * 3; // Weight genres heavily
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Check actor matches
    if (show.actors && similarityData.actors.length > 0) {
      try {
        const showActors = JSON.parse(show.actors);
        const actorMatches = showActors.filter((actor: string) => 
          similarityData.actors.includes(actor.toLowerCase())
        ).length;
        matchScore += actorMatches * 2; // Weight actors moderately
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Check director matches
    if (show.directors && similarityData.directors.length > 0) {
      try {
        const showDirectors = JSON.parse(show.directors);
        const directorMatches = showDirectors.filter((director: string) => 
          similarityData.directors.includes(director.toLowerCase())
        ).length;
        matchScore += directorMatches * 2; // Weight directors moderately
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Require at least 2 points to be considered similar
    return matchScore >= 2;
  }

  /**
   * Check if a media item matches the channel's filter criteria
   */
  private matchesFilters(media: MediaMovie | MediaShow, channel: ChannelWithRelations): boolean {
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

    // Studio filter
    if (channel.filterStudios) {
      const filterStudios = JSON.parse(channel.filterStudios);
      if (filterStudios.length > 0 && media.studio) {
        const matchesStudio = filterStudios.some((filterStudio: string) =>
          media.studio.toLowerCase().includes(filterStudio.toLowerCase())
        );
        if (!matchesStudio) return false;
      }
    }

    // Collection filter
    if (channel.filterCollections) {
      const filterCollections = JSON.parse(channel.filterCollections);
      if (filterCollections.length > 0 && media.collections) {
        try {
          const mediaCollections = JSON.parse(media.collections);
          const matchesCollection = filterCollections.some((filterCol: string) =>
            (mediaCollections as string[]).some((col: string) => col.toLowerCase() === filterCol.toLowerCase())
          );
          if (!matchesCollection) return false;
        } catch (e) {
          // Skip if invalid JSON
          return false;
        }
      } else {
        // No collections on media item, doesn't match
        return false;
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
      // Check if movie is already in channel first to prevent duplicates
      const existingChannelMovie = await prisma.channelMovie.findUnique({
        where: {
          channelId_movieId: {
            channelId,
            movieId
          }
        }
      });

      if (existingChannelMovie) {
        console.log(`Movie ${movieId} already exists in channel ${channelId}, skipping`);
        return;
      }

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

      // DO NOT auto-generate programs here - this causes infinite loops
      // Program generation should be triggered manually or on a schedule
    } catch (error) {
      console.error(`Error adding movie ${movieId} to channel ${channelId}:`, error);
      throw error; // Re-throw to let caller handle
    }
  }

  /**
   * Add a show to a channel
   */
  private async addShowToChannel(channelId: string, showId: string): Promise<void> {
    try {
      // Check if show is already in channel first to prevent duplicates
      const existingChannelShow = await prisma.channelShow.findUnique({
        where: {
          channelId_showId: {
            channelId,
            showId
          }
        }
      });

      if (existingChannelShow) {
        console.log(`Show ${showId} already exists in channel ${channelId}, skipping`);
        return;
      }

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

      // DO NOT auto-generate programs here - this causes infinite loops
      // Program generation should be triggered manually or on a schedule
    } catch (error) {
      console.error(`Error adding show ${showId} to channel ${channelId}:`, error);
      throw error; // Re-throw to let caller handle
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