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

// Rate limiting store for authentication attempts
const authAttempts = new Map<string, { count: number; lastAttempt: number; blocked: boolean }>();
const MAX_AUTH_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION = 30 * 60 * 1000; // 30 minutes

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
      'X-Plex-Platform-Version': process.version,
      'User-Agent': 'TwentyFour/Seven/2.0.0'
    };
  }

  get url(): string {
    return this.server.uri;
  }

  /**
   * Rate limiting check for authentication attempts
   */
  private checkRateLimit(identifier: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const attempt = authAttempts.get(identifier);

    if (!attempt) {
      authAttempts.set(identifier, { count: 1, lastAttempt: now, blocked: false });
      return { allowed: true };
    }

    // Check if user is currently blocked
    if (attempt.blocked && (now - attempt.lastAttempt) < BLOCK_DURATION) {
      return { allowed: false, retryAfter: Math.ceil((BLOCK_DURATION - (now - attempt.lastAttempt)) / 1000) };
    }

    // Reset if window has passed
    if ((now - attempt.lastAttempt) > RATE_LIMIT_WINDOW) {
      authAttempts.set(identifier, { count: 1, lastAttempt: now, blocked: false });
      return { allowed: true };
    }

    // Increment attempt count
    attempt.count++;
    attempt.lastAttempt = now;

    if (attempt.count > MAX_AUTH_ATTEMPTS) {
      attempt.blocked = true;
      console.warn(`Rate limit exceeded for identifier: ${identifier}. Blocking for ${BLOCK_DURATION / 1000} seconds.`);
      return { allowed: false, retryAfter: Math.ceil(BLOCK_DURATION / 1000) };
    }

    authAttempts.set(identifier, attempt);
    return { allowed: true };
  }

  /**
   * Validate and sanitize input credentials
   */
  private validateCredentials(username: string, password: string): { valid: boolean; error?: string } {
    // Basic validation
    if (!username || !password) {
      return { valid: false, error: "Username and password are required" };
    }

    // Username validation (email or username format)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const usernameRegex = /^[a-zA-Z0-9._-]{3,50}$/;
    
    if (!emailRegex.test(username) && !usernameRegex.test(username)) {
      return { valid: false, error: "Invalid username format" };
    }

    // Password validation
    if (password.length < 1 || password.length > 256) {
      return { valid: false, error: "Invalid password length" };
    }

    // Check for common injection patterns
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /\${/,
      /\{\{/
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(username) || pattern.test(password)) {
        return { valid: false, error: "Invalid characters detected" };
      }
    }

    return { valid: true };
  }

  /**
   * Secure fetch wrapper with timeout and error handling
   */
  private async secureFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...this.headers,
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Sign in to Plex with username/password using security best practices
   */
  async signIn(username: string, password: string, clientIp?: string): Promise<PlexUser> {
    // Create identifier for rate limiting (use IP + username hash for privacy)
    const identifier = clientIp ? `${clientIp}:${username}` : username;
    
    // Check rate limiting
    const rateLimitCheck = this.checkRateLimit(identifier);
    if (!rateLimitCheck.allowed) {
      const error = new Error(`Too many authentication attempts. Please try again in ${rateLimitCheck.retryAfter} seconds.`);
      (error as any).code = 'RATE_LIMITED';
      (error as any).retryAfter = rateLimitCheck.retryAfter;
      throw error;
    }

    // Validate input credentials
    const validation = this.validateCredentials(username, password);
    if (!validation.valid) {
      const error = new Error('Invalid credentials format');
      (error as any).code = 'INVALID_INPUT';
      throw error;
    }

    try {
      console.log(`[PlexAPI] Attempting authentication for user: ${username.substring(0, 3)}***`);

      const response = await this.secureFetch('https://plex.tv/users/sign_in.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Forwarded-For': clientIp || 'unknown',
        },
        body: new URLSearchParams({
          'user[login]': username,
          'user[password]': password
        })
      });

      if (!response.ok) {
        // Log failed attempt for monitoring
        console.warn(`[PlexAPI] Authentication failed for user: ${username.substring(0, 3)}*** - Status: ${response.status}`);
        
        if (response.status === 401) {
          throw new Error("Invalid username or password");
        } else if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please try again later.");
        } else if (response.status >= 500) {
          throw new Error("Plex service temporarily unavailable. Please try again later.");
        } else {
          throw new Error("Authentication failed. Please check your credentials.");
        }
      }

      const data = await response.json();
      
      if (!data.user || !data.user.authToken) {
        throw new Error("Invalid response from Plex authentication service");
      }

      this.accessToken = data.user.authToken;
      
      console.log(`[PlexAPI] Authentication successful for user: ${username.substring(0, 3)}***`);
      
      // Reset rate limiting on successful authentication
      authAttempts.delete(identifier);
      
      return {
        authToken: this.accessToken,
        user: {
          id: data.user.id,
          email: data.user.email,
          username: data.user.username
        }
      };
    } catch (error) {
      // Enhanced error logging for security monitoring
      console.error(`[PlexAPI] Authentication error for user: ${username.substring(0, 3)}***`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        clientIp: clientIp || 'unknown'
      });

      if (error instanceof Error) {
        // Don't expose internal error details to client
        if (error.message.includes('fetch') || error.message.includes('network')) {
          throw new Error("Network error. Please check your connection and try again.");
        }
        throw error;
      }
      
      throw new Error("Authentication failed due to an unexpected error");
    }
  }

  /**
   * Get available Plex servers for the authenticated user
   */
  async getServers(): Promise<PlexServer[]> {
    if (!this.accessToken) {
      throw new Error("No access token available. Please sign in first.");
    }

    try {
      const response = await this.secureFetch('https://plex.tv/pms/servers.xml', {
        headers: {
          'X-Plex-Token': this.accessToken
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Access token has expired. Please sign in again.");
        }
        throw new Error("Failed to fetch Plex servers");
      }

      const xmlText = await response.text();
      return this.parseServersXML(xmlText);
    } catch (error) {
      console.error('[PlexAPI] Error fetching servers:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to retrieve server list");
    }
  }

  /**
   * Test connection to a Plex server with enhanced security
   */
  async testConnection(uri: string, token: string): Promise<boolean> {
    if (!uri || !token) {
      return false;
    }

    // Validate URI format
    try {
      new URL(uri);
    } catch {
      return false;
    }

    try {
      const response = await this.secureFetch(`${uri}/identity`, {
        headers: {
          'X-Plex-Token': token
        }
      });
      return response.ok;
    } catch (error) {
      console.warn(`[PlexAPI] Connection test failed for ${uri}:`, error);
      return false;
    }
  }

  /**
   * Get libraries from a Plex server
   */
  async getLibraries(uri: string, token: string): Promise<PlexLibrary[]> {
    try {
      const response = await this.secureFetch(`${uri}/library/sections`, {
        headers: {
          'X-Plex-Token': token
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Access token is invalid or expired");
        }
        throw new Error(`Failed to fetch libraries: ${response.status}`);
      }

      const data = await response.json();
      return data.MediaContainer?.Directory || [];
    } catch (error) {
      console.error(`[PlexAPI] Error fetching libraries from ${uri}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to retrieve library list");
    }
  }

  /**
   * Get media items from a library
   */
  async getLibraryContent(uri: string, token: string, libraryKey: string, type?: string): Promise<PlexMedia[]> {
    let url = `${uri}/library/sections/${libraryKey}/all`;
    if (type) {
      url += `?type=${type}`;
    }

    try {
      const response = await this.secureFetch(url, {
        headers: {
          'X-Plex-Token': token
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Access token is invalid or expired");
        }
        throw new Error(`Failed to fetch library content: ${response.status}`);
      }

      const data = await response.json();
      return data.MediaContainer?.Metadata || [];
    } catch (error) {
      console.error(`[PlexAPI] Error fetching library content from ${url}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to retrieve library content");
    }
  }

  /**
   * Get episodes for a TV show
   */
  async getShowEpisodes(uri: string, token: string, showKey: string): Promise<PlexEpisode[]> {
    try {
      const response = await this.secureFetch(`${uri}/library/metadata/${showKey}/allLeaves`, {
        headers: {
          'X-Plex-Token': token
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Access token is invalid or expired");
        }
        throw new Error(`Failed to fetch show episodes: ${response.status}`);
      }

      const data = await response.json();
      return data.MediaContainer?.Metadata || [];
    } catch (error) {
      console.error(`[PlexAPI] Error fetching episodes for show ${showKey}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to retrieve show episodes");
    }
  }

  /**
   * Get server information
   */
  async getServerInfo(uri: string, token: string): Promise<any> {
    try {
      const response = await this.secureFetch(`${uri}/`, {
        headers: {
          'X-Plex-Token': token
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Access token is invalid or expired");
        }
        throw new Error(`Failed to fetch server info: ${response.status}`);
      }

      const data = await response.json();
      return data.MediaContainer;
    } catch (error) {
      console.error(`[PlexAPI] Error fetching server info from ${uri}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("Failed to retrieve server information");
    }
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
      
      const response = await this.secureFetch(`${uri}/library/metadata/${ratingKey}`, {
        headers: {
          'Accept': 'application/json',
          'X-Plex-Token': token
        }
      });

      if (!response.ok) {
        console.error(`[PlexAPI] Failed to fetch media metadata: ${response.status} ${response.statusText}`);
        if (response.status === 401) {
          throw new Error("Access token is invalid or expired");
        }
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

      console.log(`[PlexAPI] Could not find part in JSON response for ${ratingKey}`);
      return null;
    } catch (error) {
      console.error(`[PlexAPI] Error getting media parts for ${ratingKey}:`, error);
      
      // Fallback: try XML parsing if JSON fails
      try {
        console.log('[PlexAPI] Retrying with XML parsing...');
        const response = await this.secureFetch(`${uri}/library/metadata/${ratingKey}`, {
          headers: {
            'X-Plex-Token': token
          }
        });
        
        if (!response.ok) {
          return null;
        }
        
        const xmlText = await response.text();
        const partMatch = xmlText.match(/<Part[^>]+key="([^"]+)"[^>]+duration="([^"]+)"/);
      
        if (partMatch) {
          const partKey = partMatch[1];
          const duration = parseInt(partMatch[2], 10);
          
          console.log(`[PlexAPI] Found part via XML fallback: key=${partKey}, duration=${duration}`);
          return { partKey, duration };
        }
      } catch (xmlError) {
        console.error('[PlexAPI] XML fallback also failed:', xmlError);
      }
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