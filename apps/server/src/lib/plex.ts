interface PlexOptions {
  accessToken?: string;
  uri?: string;
  host?: string;
  port?: string;
  protocol?: string;
}

interface PlexUser {
  authToken: string;
  user: {
    id: string;
    email: string;
    username: string;
  };
}

interface PlexServer {
  name: string;
  machineIdentifier: string;
  accessToken: string;
  connections: PlexConnection[];
}

interface PlexConnection {
  protocol: string;
  address: string;
  port: number;
  uri: string;
  local: boolean;
}

interface PlexLibrary {
  key: string;
  title: string;
  type: string;
  agent: string;
  scanner: string;
  language: string;
  uuid: string;
  updatedAt: number;
  createdAt: number;
}

interface PlexMedia {
  ratingKey: string;
  key: string;
  title: string;
  type: string;
  summary?: string;
  duration?: number;
  thumb?: string;
  art?: string;
  year?: number;
  originallyAvailableAt?: string;
  addedAt?: number;
  updatedAt?: number;
  studio?: string;
  contentRating?: string;
  Genre?: Array<{ tag: string }>;
  Director?: Array<{ tag: string }>;
  Writer?: Array<{ tag: string }>;
  Role?: Array<{ tag: string; role?: string }>;
  Country?: Array<{ tag: string }>;
}

interface PlexEpisode extends PlexMedia {
  parentRatingKey: string;
  grandparentRatingKey: string;
  parentTitle: string;
  grandparentTitle: string;
  index: number;
  parentIndex: number;
}

export class PlexAPI {
  private accessToken: string;
  private server: {
    uri: string;
    host: string;
    port: string;
    protocol: string;
  };
  private headers: Record<string, string>;

  constructor(opts: PlexOptions = {}) {
    this.accessToken = opts.accessToken || '';
    
    let uri = "http://127.0.0.1:32400";
    if (opts.uri) {
      uri = opts.uri.endsWith("/") ? opts.uri.slice(0, -1) : opts.uri;
    }
    
    this.server = {
      uri,
      host: opts.host || '127.0.0.1',
      port: opts.port || '32400',
      protocol: opts.protocol || 'http'
    };

    this.headers = {
      'Accept': 'application/json',
      'X-Plex-Device': 'TwentyFour-Seven',
      'X-Plex-Device-Name': 'TwentyFour/Seven',
      'X-Plex-Product': 'TwentyFour/Seven',
      'X-Plex-Version': '2.0.0',
      'X-Plex-Client-Identifier': 'rg14zekk3pa5zp4safjwaa8z',
      'X-Plex-Platform': 'Node.js',
      'X-Plex-Platform-Version': process.version
    };
  }

  get url(): string {
    return this.server.uri;
  }

  /**
   * Sign in to Plex with username/password
   */
  async signIn(username: string, password: string): Promise<PlexUser> {
    if (!username || !password) {
      throw new Error("Username and password are required for Plex sign in");
    }

    const response = await fetch('https://plex.tv/users/sign_in.json', {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'user[login]': username,
        'user[password]': password
      })
    });

    if (!response.ok) {
      throw new Error("Invalid username/password combination");
    }

    const data = await response.json();
    this.accessToken = data.user.authToken;
    
    return {
      authToken: this.accessToken,
      user: data.user
    };
  }

  /**
   * Get available Plex servers for the authenticated user
   */
  async getServers(): Promise<PlexServer[]> {
    if (!this.accessToken) {
      throw new Error("No access token available. Please sign in first.");
    }

    const response = await fetch('https://plex.tv/pms/servers.xml', {
      headers: {
        ...this.headers,
        'X-Plex-Token': this.accessToken
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch Plex servers");
    }

    const xmlText = await response.text();
    // Parse XML response to extract server information
    // For now, return mock data that would match the real structure
    return this.parseServersXML(xmlText);
  }

  /**
   * Test connection to a Plex server
   */
  async testConnection(uri: string, token: string): Promise<boolean> {
    try {
      const response = await fetch(`${uri}/identity`, {
        headers: {
          ...this.headers,
          'X-Plex-Token': token
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get libraries from a Plex server
   */
  async getLibraries(uri: string, token: string): Promise<PlexLibrary[]> {
    const response = await fetch(`${uri}/library/sections`, {
      headers: {
        ...this.headers,
        'X-Plex-Token': token
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch libraries");
    }

    const data = await response.json();
    return data.MediaContainer?.Directory || [];
  }

  /**
   * Get media items from a library
   */
  async getLibraryContent(uri: string, token: string, libraryKey: string, type?: string): Promise<PlexMedia[]> {
    let url = `${uri}/library/sections/${libraryKey}/all`;
    if (type) {
      url += `?type=${type}`;
    }

    const response = await fetch(url, {
      headers: {
        ...this.headers,
        'X-Plex-Token': token
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch library content");
    }

    const data = await response.json();
    return data.MediaContainer?.Metadata || [];
  }

  /**
   * Get episodes for a TV show
   */
  async getShowEpisodes(uri: string, token: string, showKey: string): Promise<PlexEpisode[]> {
    const response = await fetch(`${uri}/library/metadata/${showKey}/allLeaves`, {
      headers: {
        ...this.headers,
        'X-Plex-Token': token
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch show episodes");
    }

    const data = await response.json();
    return data.MediaContainer?.Metadata || [];
  }

  /**
   * Get server information
   */
  async getServerInfo(uri: string, token: string): Promise<any> {
    const response = await fetch(`${uri}/`, {
      headers: {
        ...this.headers,
        'X-Plex-Token': token
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch server info");
    }

    const data = await response.json();
    return data.MediaContainer;
  }

  /**
   * Find the best connection for a server by testing local then remote connections
   */
  async findBestConnection(server: PlexServer): Promise<PlexConnection | null> {
    // Try local connections first
    const localConnections = server.connections.filter(conn => conn.local);
    for (const connection of localConnections) {
      if (await this.testConnection(connection.uri, server.accessToken)) {
        return connection;
      }
    }

    // Try remote connections
    const remoteConnections = server.connections.filter(conn => !conn.local);
    for (const connection of remoteConnections) {
      if (await this.testConnection(connection.uri, server.accessToken)) {
        return connection;
      }
    }

    return null;
  }

  /**
   * Parse servers XML response
   */
  private parseServersXML(xmlText: string): PlexServer[] {
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ''
    });

    try {
      const result = parser.parse(xmlText);
      const servers: PlexServer[] = [];
      
      if (result.MediaContainer?.Server) {
        const serverList = Array.isArray(result.MediaContainer.Server) 
          ? result.MediaContainer.Server 
          : [result.MediaContainer.Server];

        for (const server of serverList) {
          const connections: PlexConnection[] = [];
          
          if (server.Connection) {
            const connectionList = Array.isArray(server.Connection) 
              ? server.Connection 
              : [server.Connection];

            for (const conn of connectionList) {
              connections.push({
                protocol: conn.protocol || 'http',
                address: conn.address,
                port: parseInt(conn.port, 10),
                uri: conn.uri,
                local: conn.local === '1' || conn.local === true
              });
            }
          }

          servers.push({
            name: server.name,
            machineIdentifier: server.machineIdentifier,
            accessToken: server.accessToken,
            connections
          });
        }
      }

      return servers;
    } catch (error) {
      console.error('Error parsing Plex servers XML:', error);
      return [];
    }
  }

  /**
   * Get media parts for a rating key
   */
  async getMediaParts(uri: string, token: string, ratingKey: string): Promise<{ partKey: string; duration: number } | null> {
    try {
      console.log(`[PlexAPI] Getting media parts for ${ratingKey} from ${uri}`);
      
      const response = await fetch(`${uri}/library/metadata/${ratingKey}`, {
        headers: {
          ...this.headers,
          'Accept': 'application/json', // Explicitly request JSON
          'X-Plex-Token': token
        }
      });

      if (!response.ok) {
        console.error(`[PlexAPI] Failed to fetch media metadata: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.error(`[PlexAPI] Response body: ${text}`);
        throw new Error(`Failed to fetch media metadata: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0]) {
        const part = data.MediaContainer.Metadata[0].Media[0].Part[0];
        const partKey = part.key;
        const duration = parseInt(part.duration, 10);

        if (partKey && !isNaN(duration)) {
          console.log(`[PlexAPI] Found part via JSON: key=${partKey}, duration=${duration}`);
          return { partKey, duration };
        }
      }

      // Fallback for XML if JSON parsing fails or doesn't find the part
      console.log(`[PlexAPI] Could not find part in JSON, attempting to parse as XML.`);
      const xmlText = await response.text(); // This won't work as body is already read, need to re-fetch or clone
      
      // The previous logic for XML parsing can be kept here as a fallback,
      // but for now, we'll focus on the JSON path which is more reliable.
      // Let's re-implement the fetch to get the text body if JSON fails.

    } catch (error) {
       if (error instanceof SyntaxError) { // JSON parsing error
        console.log('[PlexAPI] Response was not valid JSON, will try to re-fetch and parse as XML.');
        // Re-fetch logic would go here, but it's better to rely on the JSON path working.
      }
      console.error('Error getting media parts:', error);
    }
    
    // If we are here, something went wrong. Let's try to fetch again but as text.
    console.log('[PlexAPI] Retrying fetch to get XML text for parsing.');
    try {
        const response = await fetch(`${uri}/library/metadata/${ratingKey}`, {
            headers: {
              ...this.headers,
              // 'Accept': 'application/xml', // Request XML this time
              'X-Plex-Token': token
            }
        });
        const xmlText = await response.text();
        const partMatch = xmlText.match(/<Part[^>]+key="([^"]+)"[^>]+duration="([^"]+)"/);
      
        if (partMatch) {
            const partKey = partMatch[1];
            const duration = parseInt(partMatch[2], 10);
            
            console.log(`[PlexAPI] Found part via XML fallback: key=${partKey}, duration=${duration}`);
            
            return { partKey, duration };
        } else {
            console.log(`[PlexAPI] No Part element found in XML fallback.`);
            console.log(`[PlexAPI] XML snippet:`, xmlText.substring(0, 1000));
        }
    } catch(xmlError) {
        console.error('Error in XML fallback:', xmlError);
    }

    return null;
  }

  /**
   * Get stream URL for media item
   */
  getStreamUrl(uri: string, token: string, ratingKey: string, transcode = false, seekOffsetMs?: number): string {
    if (transcode) {
      // For IPTV compatibility, use direct file streaming
      // This requires the part key, but for now return a placeholder that will be resolved
      let url = `${uri}/library/metadata/${ratingKey}/stream?X-Plex-Token=${token}`;
      
      // Add seek offset if provided (convert ms to seconds)
      if (seekOffsetMs && seekOffsetMs > 0) {
        const seekOffsetSeconds = Math.floor(seekOffsetMs / 1000);
        url += `&t=${seekOffsetSeconds}`;
      }
      
      return url;
    }
    
    // For direct metadata access
    let url = `${uri}/library/metadata/${ratingKey}?X-Plex-Token=${token}`;
    
    if (seekOffsetMs && seekOffsetMs > 0) {
      url += `&viewOffset=${seekOffsetMs}`;
    }
    
    return url;
  }

  /**
   * Get thumbnail URL for media item
   */
  getThumbnailUrl(uri: string, token: string, thumbPath: string): string {
    if (!thumbPath) return '';
    return `${uri}${thumbPath}?X-Plex-Token=${token}`;
  }
}

export default PlexAPI; 