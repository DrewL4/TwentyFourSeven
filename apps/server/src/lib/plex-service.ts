import { PlexAPI } from './plex';
import { prisma } from './prisma';
import type { MediaServer, MediaLibrary } from '../../prisma/generated';

interface PlexLoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    username: string;
  };
  servers: PlexServerDiscovery[];
}

interface PlexServerDiscovery {
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
}

interface PlexServerConfig {
  name: string;
  uri: string;
  accessToken: string;
  arGuide?: boolean;
  arChannels?: boolean;
}

export class PlexService {
  /**
   * Login to Plex and discover available servers
   */
  static async login(username: string, password: string): Promise<PlexLoginResult> {
    const plex = new PlexAPI();
    
    // Sign in to get access token
    const loginResult = await plex.signIn(username, password);
    
    // Get available servers
    const servers = await plex.getServers();
    
    // Test connections and find best one for each server
    const discoveredServers: PlexServerDiscovery[] = [];
    
    for (const server of servers) {
      const bestConnection = await plex.findBestConnection(server);
      
      discoveredServers.push({
        name: server.name,
        machineIdentifier: server.machineIdentifier,
        accessToken: server.accessToken,
        bestConnection: bestConnection ? {
          uri: bestConnection.uri,
          protocol: bestConnection.protocol,
          address: bestConnection.address,
          port: bestConnection.port,
          local: bestConnection.local
        } : null,
        allConnections: server.connections.map(conn => ({
          uri: conn.uri,
          protocol: conn.protocol,
          address: conn.address,
          port: conn.port,
          local: conn.local
        }))
      });
    }
    
    return {
      accessToken: loginResult.authToken,
      user: loginResult.user,
      servers: discoveredServers
    };
  }

  /**
   * Add a Plex server to the database
   */
  static async addPlexServer(config: PlexServerConfig): Promise<MediaServer> {
    // Test the connection first
    const plex = new PlexAPI({ uri: config.uri });
    const connectionValid = await plex.testConnection(config.uri, config.accessToken);
    
    if (!connectionValid) {
      throw new Error('Unable to connect to Plex server with provided configuration');
    }

    // Check if server already exists
    const existingServer = await prisma.mediaServer.findFirst({
      where: {
        url: config.uri,
        type: 'PLEX'
      }
    });

    if (existingServer) {
      // Update existing server
      return await prisma.mediaServer.update({
        where: { id: existingServer.id },
        data: {
          name: config.name,
          token: config.accessToken,
          active: true
        }
      });
    }

    // Create new server
    const newServer = await prisma.mediaServer.create({
      data: {
        name: config.name,
        url: config.uri,
        token: config.accessToken,
        type: 'PLEX',
        active: true
      }
    });

    // Automatically sync libraries after adding the server
    try {
      await this.syncLibraries(newServer.id);
    } catch (error) {
      console.warn('Failed to auto-sync libraries after adding server:', error);
      // Don't fail the server creation if library sync fails
    }

    return newServer;
  }

  /**
   * Sync libraries from a Plex server (fast metadata-only sync)
   */
  static async syncLibraries(serverId: string): Promise<{ success: boolean; message: string; count?: number }> {
    const server = await prisma.mediaServer.findUnique({
      where: { id: serverId },
      include: { libraries: true }
    });

    if (!server) {
      throw new Error('Server not found');
    }

    if (server.type !== 'PLEX') {
      throw new Error('Server is not a Plex server');
    }

    if (!server.token) {
      throw new Error('Server has no access token');
    }

    const plex = new PlexAPI({ uri: server.url });
    
    try {
      // Get libraries from Plex (fast operation)
      const plexLibraries = await plex.getLibraries(server.url, server.token);
      
      // Sync library metadata only (very fast)
      let syncCount = 0;
      
      for (const plexLib of plexLibraries) {
        // Map Plex library types to our enum
        let libraryType: 'MOVIE' | 'SHOW' | 'MUSIC';
        switch (plexLib.type) {
          case 'movie':
            libraryType = 'MOVIE';
            break;
          case 'show':
            libraryType = 'SHOW';
            break;
          case 'artist':
            libraryType = 'MUSIC';
            break;
          default:
            continue; // Skip unsupported library types
        }

        // Create or update library metadata only
        await prisma.mediaLibrary.upsert({
          where: {
            serverId_key: {
              serverId: server.id,
              key: plexLib.key
            }
          },
          update: {
            name: plexLib.title,
            type: libraryType,
            updatedAt: new Date()
          },
          create: {
            serverId: server.id,
            name: plexLib.title,
            key: plexLib.key,
            type: libraryType
          }
        });

        syncCount++;
      }

      // Start background content sync (non-blocking)
      setImmediate(() => {
        this.syncLibraryContentInBackground(serverId).catch(error => {
          console.error('Background sync failed:', error);
        });
      });

      return {
        success: true,
        message: `Library metadata synced for ${syncCount} libraries. Content sync started in background.`,
        count: syncCount
      };
    } catch (error) {
      console.error('Error syncing Plex libraries:', error);
      return {
        success: false,
        message: `Failed to sync libraries: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Sync library content in background (non-blocking)
   */
  private static async syncLibraryContentInBackground(serverId: string): Promise<void> {
    console.log(`Starting background content sync for server ${serverId}`);
    
    const server = await prisma.mediaServer.findUnique({
      where: { id: serverId },
      include: { libraries: true }
    });

    if (!server || !server.token) {
      console.error('Server not found or no token for background sync');
      return;
    }

    const plex = new PlexAPI({ uri: server.url });

    // Sync each library's content with batching
    for (const library of server.libraries) {
      try {
        console.log(`Background syncing content for library: ${library.name}`);
        await this.syncLibraryContentBatched(server, library, plex);
      } catch (error) {
        console.error(`Failed to sync library ${library.name}:`, error);
        // Continue with other libraries even if one fails
      }
    }

    console.log(`Background content sync completed for server ${serverId}`);
  }

  /**
   * Sync content for a specific library with batching and pagination
   */
  private static async syncLibraryContentBatched(
    server: MediaServer, 
    library: MediaLibrary, 
    plex: PlexAPI
  ): Promise<void> {
    if (!server.token) return;

    try {
      if (library.type === 'MOVIE') {
        await this.syncMoviesBatched(server, library, plex);
      } else if (library.type === 'SHOW') {
        await this.syncShowsBatched(server, library, plex);
      }
    } catch (error) {
      console.error(`Error syncing content for library ${library.name}:`, error);
    }
  }

  /**
   * Sync movies with batching
   */
  private static async syncMoviesBatched(
    server: MediaServer,
    library: MediaLibrary,
    plex: PlexAPI
  ): Promise<void> {
    if (!server.token) return;

    const movies = await plex.getLibraryContent(server.url, server.token, library.key, '1');
    
    // Batch upsert movies
    const batchSize = 50;
    for (let i = 0; i < movies.length; i += batchSize) {
      const batch = movies.slice(i, i + batchSize);
      
      // Process batch
      const upsertPromises = batch.map(movie => 
        prisma.mediaMovie.upsert({
          where: {
            libraryId_ratingKey: {
              libraryId: library.id,
              ratingKey: movie.ratingKey
            }
          },
          update: {
            title: movie.title,
            year: movie.year,
            summary: movie.summary,
            poster: movie.thumb && server.token ? plex.getThumbnailUrl(server.url, server.token, movie.thumb) : null,
            backdrop: movie.art && server.token ? plex.getThumbnailUrl(server.url, server.token, movie.art) : null,
            duration: movie.duration || 0,
            // Additional metadata fields
            studio: movie.studio || null,
            contentRating: movie.contentRating || null,
            genres: JSON.stringify(movie.Genre?.map(g => g.tag) || []),
            directors: JSON.stringify(movie.Director?.map(d => d.tag) || []),
            writers: JSON.stringify(movie.Writer?.map(w => w.tag) || []),
            actors: JSON.stringify(movie.Role?.map(r => r.tag) || []),
            countries: JSON.stringify(movie.Country?.map(c => c.tag) || []),
            collections: JSON.stringify(((movie as any).Collection?.map((co:any) => co.tag)) || [])
          },
          create: {
            libraryId: library.id,
            title: movie.title,
            year: movie.year,
            summary: movie.summary,
            poster: movie.thumb && server.token ? plex.getThumbnailUrl(server.url, server.token, movie.thumb) : null,
            backdrop: movie.art && server.token ? plex.getThumbnailUrl(server.url, server.token, movie.art) : null,
            duration: movie.duration || 0,
            ratingKey: movie.ratingKey,
            // Additional metadata fields
            studio: movie.studio || null,
            contentRating: movie.contentRating || null,
            genres: JSON.stringify(movie.Genre?.map(g => g.tag) || []),
            directors: JSON.stringify(movie.Director?.map(d => d.tag) || []),
            writers: JSON.stringify(movie.Writer?.map(w => w.tag) || []),
            actors: JSON.stringify(movie.Role?.map(r => r.tag) || []),
            countries: JSON.stringify(movie.Country?.map(c => c.tag) || []),
            collections: JSON.stringify(((movie as any).Collection?.map((co:any) => co.tag)) || [])
          }
        })
      );

      await Promise.all(upsertPromises);
      
      // Small delay between batches to avoid overwhelming the database
      if (i + batchSize < movies.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Trigger channel automation after movie sync
    try {
      const { channelAutomationService } = await import('./channel-automation-service');
      await channelAutomationService.processAutomatedChannels();
    } catch (error) {
      console.error('Failed to process channel automation after movie sync:', error);
    }

    // Remove movies that no longer exist in the Plex library
    try {
      const plexRatingKeys = movies.map(m => m.ratingKey);
      await prisma.mediaMovie.deleteMany({
        where: {
          libraryId: library.id,
          ratingKey: {
            notIn: plexRatingKeys.length > 0 ? plexRatingKeys : ['__none__'] // prevent empty array error
          }
        }
      });
    } catch (cleanupError) {
      console.error(`Failed to remove deleted movies for library ${library.name}:`, cleanupError);
    }
  }

  /**
   * Sync TV shows with batching
   */
  private static async syncShowsBatched(
    server: MediaServer,
    library: MediaLibrary,
    plex: PlexAPI
  ): Promise<void> {
    if (!server.token) return;

    const shows = await plex.getLibraryContent(server.url, server.token, library.key, '2');
    
    // Batch upsert shows
    const batchSize = 25; // Smaller batch for shows since they're more complex
    for (let i = 0; i < shows.length; i += batchSize) {
      const batch = shows.slice(i, i + batchSize);
      
      for (const show of batch) {
        const dbShow = await prisma.mediaShow.upsert({
          where: {
            libraryId_ratingKey: {
              libraryId: library.id,
              ratingKey: show.ratingKey
            }
          },
          update: {
            title: show.title,
            year: show.year,
            summary: show.summary,
            poster: show.thumb && server.token ? plex.getThumbnailUrl(server.url, server.token, show.thumb) : null,
            backdrop: show.art && server.token ? plex.getThumbnailUrl(server.url, server.token, show.art) : null,
            // Additional metadata fields
            studio: show.studio || null,
            contentRating: show.contentRating || null,
            genres: JSON.stringify(show.Genre?.map(g => g.tag) || []),
            directors: JSON.stringify(show.Director?.map(d => d.tag) || []),
            writers: JSON.stringify(show.Writer?.map(w => w.tag) || []),
            actors: JSON.stringify(show.Role?.map(r => r.tag) || []),
            countries: JSON.stringify(show.Country?.map(c => c.tag) || []),
            collections: JSON.stringify(((show as any).Collection?.map((co:any) => co.tag)) || [])
          },
          create: {
            libraryId: library.id,
            title: show.title,
            year: show.year,
            summary: show.summary,
            poster: show.thumb && server.token ? plex.getThumbnailUrl(server.url, server.token, show.thumb) : null,
            backdrop: show.art && server.token ? plex.getThumbnailUrl(server.url, server.token, show.art) : null,
            ratingKey: show.ratingKey,
            // Additional metadata fields
            studio: show.studio || null,
            contentRating: show.contentRating || null,
            genres: JSON.stringify(show.Genre?.map(g => g.tag) || []),
            directors: JSON.stringify(show.Director?.map(d => d.tag) || []),
            writers: JSON.stringify(show.Writer?.map(w => w.tag) || []),
            actors: JSON.stringify(show.Role?.map(r => r.tag) || []),
            countries: JSON.stringify(show.Country?.map(c => c.tag) || []),
            collections: JSON.stringify(((show as any).Collection?.map((co:any) => co.tag)) || [])
          }
        });

        // Sync episodes for this show (also batched)
        await this.syncEpisodesForShow(server, dbShow, plex);
      }
      
      // Small delay between show batches
      if (i + batchSize < shows.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Trigger channel automation after shows sync
    try {
      const { channelAutomationService } = await import('./channel-automation-service');
      await channelAutomationService.processAutomatedChannels();
    } catch (error) {
      console.error('Failed to process channel automation after shows sync:', error);
    }

    // Remove shows that no longer exist in the Plex library (and cascade delete related episodes/programs)
    try {
      const plexRatingKeys = shows.map(s => s.ratingKey);
      await prisma.mediaShow.deleteMany({
        where: {
          libraryId: library.id,
          ratingKey: {
            notIn: plexRatingKeys.length > 0 ? plexRatingKeys : ['__none__']
          }
        }
      });
    } catch (cleanupError) {
      console.error(`Failed to remove deleted shows for library ${library.name}:`, cleanupError);
    }
  }

  /**
   * Sync episodes for a specific show with batching
   */
  private static async syncEpisodesForShow(
    server: MediaServer,
    show: any,
    plex: PlexAPI
  ): Promise<void> {
    if (!server.token) return;

    try {
      const episodes = await plex.getShowEpisodes(server.url, server.token, show.ratingKey);
      
      // Batch upsert episodes
      const batchSize = 100;
      for (let i = 0; i < episodes.length; i += batchSize) {
        const batch = episodes.slice(i, i + batchSize);
        
        const upsertPromises = batch.map(episode =>
          prisma.mediaEpisode.upsert({
            where: {
              showId_ratingKey: {
                showId: show.id,
                ratingKey: episode.ratingKey
              }
            },
            update: {
              title: episode.title,
              summary: episode.summary,
              duration: episode.duration || 0,
              seasonNumber: episode.parentIndex || 1,
              episodeNumber: episode.index || 1,
              thumb: episode.thumb && server.token ? plex.getThumbnailUrl(server.url, server.token, episode.thumb) : null
            },
            create: {
              showId: show.id,
              title: episode.title,
              summary: episode.summary,
              duration: episode.duration || 0,
              seasonNumber: episode.parentIndex || 1,
              episodeNumber: episode.index || 1,
              thumb: episode.thumb && server.token ? plex.getThumbnailUrl(server.url, server.token, episode.thumb) : null,
              ratingKey: episode.ratingKey
            }
          })
        );

        await Promise.all(upsertPromises);
      }

      // Cleanup: remove any episodes for this show that are no longer present (fast check using show episodes list)
      try {
        // Fetch the latest episode list for the show from Plex
        const plexEpisodes = await plex.getShowEpisodes(server.url, server.token, show.ratingKey);
        const plexRatingKeys = plexEpisodes.map((e: any) => e.ratingKey);

        await prisma.mediaEpisode.deleteMany({
          where: {
            showId: show.id,
            ratingKey: {
              notIn: plexRatingKeys.length > 0 ? plexRatingKeys : ['__none__']
            }
          }
        });
      } catch (cleanupError) {
        console.error(`Failed to remove deleted episodes for show ${show.title}:`, cleanupError);
      }
    } catch (error) {
      console.error(`Error syncing episodes for show ${show.title}:`, error);
    }
  }

  /**
   * Test connection to a Plex server
   */
  static async testConnection(uri: string, token: string): Promise<boolean> {
    const plex = new PlexAPI({ uri });
    return await plex.testConnection(uri, token);
  }

  /**
   * Get server info
   */
  static async getServerInfo(uri: string, token: string) {
    const plex = new PlexAPI({ uri });
    return await plex.getServerInfo(uri, token);
  }

  /**
   * Get stream URL for media
   */
  static getStreamUrl(serverUrl: string, token: string, ratingKey: string, transcode = false, seekOffsetMs?: number): string {
    const plex = new PlexAPI({ uri: serverUrl });
    return plex.getStreamUrl(serverUrl, token, ratingKey, transcode, seekOffsetMs);
  }

  /**
   * Get proper streaming URL by resolving media parts first
   */
  static async getProperStreamUrl(serverUrl: string, token: string, ratingKey: string, seekOffsetMs?: number): Promise<string> {
    const plex = new PlexAPI({ uri: serverUrl });
    
    try {
      // Get media parts first
      const mediaParts = await plex.getMediaParts(serverUrl, token, ratingKey);
      
      if (mediaParts && mediaParts.partKey) {
        // Use direct file streaming with the part key
        let url = `${serverUrl}${mediaParts.partKey}?X-Plex-Token=${token}`;
        
        // Add seek offset if provided (convert ms to seconds)
        if (seekOffsetMs && seekOffsetMs > 0) {
          const seekOffsetSeconds = Math.floor(seekOffsetMs / 1000);
          url += `&t=${seekOffsetSeconds}`;
        }
        
        return url;
      }
      
      // Fallback to basic URL
      return `${serverUrl}/library/metadata/${ratingKey}?X-Plex-Token=${token}`;
      
    } catch (error) {
      console.error('Error resolving proper stream URL:', error);
      // Fallback to basic URL
      return `${serverUrl}/library/metadata/${ratingKey}?X-Plex-Token=${token}`;
    }
  }

  /**
   * Map Plex library type to our LibraryType enum
   */
  private static mapPlexTypeToLibraryType(plexType: string): 'MOVIE' | 'SHOW' | 'MUSIC' {
    switch (plexType.toLowerCase()) {
      case 'movie':
        return 'MOVIE';
      case 'show':
        return 'SHOW';
      case 'artist':
      case 'music':
        return 'MUSIC';
      default:
        return 'MOVIE'; // Default fallback
    }
  }

  /**
   * Update library selection for a server
   */
  static async updateLibrarySelection(serverId: string, selectedLibraryKeys: string[]): Promise<{ success: boolean; message: string; updatedCount?: number; removedCount?: number }> {
    try {
      // Get the server
      const server = await prisma.mediaServer.findUnique({
        where: { id: serverId },
        include: { libraries: true }
      });

      if (!server) {
        return { success: false, message: 'Server not found' };
      }

      // Get current libraries
      const currentLibraries = server.libraries;
      const currentKeys = currentLibraries.map(lib => lib.key);

      // Find libraries to remove (in database but not selected)
      const librariesToRemove = currentLibraries.filter(lib => !selectedLibraryKeys.includes(lib.key));

      // Remove deselected libraries and their content
      let removedCount = 0;
      for (const library of librariesToRemove) {
        // Delete all related content first
        await prisma.mediaEpisode.deleteMany({
          where: {
            show: {
              libraryId: library.id
            }
          }
        });

        await prisma.mediaShow.deleteMany({
          where: { libraryId: library.id }
        });

        await prisma.mediaMovie.deleteMany({
          where: { libraryId: library.id }
        });

        // Delete the library itself
        await prisma.mediaLibrary.delete({
          where: { id: library.id }
        });

        removedCount++;
        console.log(`Removed library: ${library.name}`);
      }

      // Find new libraries to add (selected but not in database)
      const newLibraryKeys = selectedLibraryKeys.filter(key => !currentKeys.includes(key));

      // Add new libraries if any
      let addedCount = 0;
      if (newLibraryKeys.length > 0) {
        // Get library info from Plex
        const plex = new PlexAPI({ uri: server.url });
        if (server.token) {
          const allLibraries = await plex.getLibraries(server.url, server.token);
          
          for (const key of newLibraryKeys) {
            const libraryInfo = allLibraries.find(lib => lib.key === key);
            if (libraryInfo) {
              const libraryType = this.mapPlexTypeToLibraryType(libraryInfo.type);
              
              await prisma.mediaLibrary.create({
                data: {
                  name: libraryInfo.title,
                  key: libraryInfo.key,
                  type: libraryType,
                  serverId: server.id
                }
              });

              addedCount++;
              console.log(`Added library: ${libraryInfo.title}`);
            }
          }
        }
      }

      // Start background sync for remaining/new libraries
      if (selectedLibraryKeys.length > 0) {
        // Use setImmediate to ensure database operations are fully complete before syncing
        setImmediate(() => {
          this.syncLibraryContentInBackground(serverId);
        });
      }

      const message = `Library selection updated. ${addedCount} libraries added, ${removedCount} libraries removed.${selectedLibraryKeys.length > 0 ? ' Content sync started in background.' : ''}`;
      
      return { 
        success: true, 
        message,
        updatedCount: addedCount,
        removedCount 
      };

    } catch (error) {
      console.error('Error updating library selection:', error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  }
}

export default PlexService; 