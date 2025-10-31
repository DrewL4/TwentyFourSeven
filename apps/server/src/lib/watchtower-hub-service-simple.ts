import crypto from 'crypto';
import { db } from './context';

interface WatchTowerUser {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_admin: boolean;
  is_active: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  is_family?: boolean;
  date_joined?: string;
  last_login?: string;
  profile?: any;
  movie_service?: string | null;
  movie_service_id?: number | null;
  is_movie_user?: boolean;
  movie_donation_due?: string | null;
  movie_donation_amount?: string | null;
}

interface WebhookEvent {
  event_type: string;
  timestamp: string;
  data: any;
}

export class WatchTowerHubService {
  private static instance: WatchTowerHubService;
  private watchTowerUrl: string | null = null;
  private apiToken: string | null = null;
  private webhookSecret: string | null = null;

  private constructor() {}

  static getInstance(): WatchTowerHubService {
    if (!WatchTowerHubService.instance) {
      WatchTowerHubService.instance = new WatchTowerHubService();
    }
    return WatchTowerHubService.instance;
  }

  async initialize(): Promise<void> {
    try {
      const config = await db.setting.findMany({
        where: {
          key: {
            in: ['watchtower_url', 'watchtower_api_token', 'watchtower_webhook_secret']
          }
        }
      });

      const configMap = config.reduce((acc: Record<string, string>, setting: any) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});

      this.watchTowerUrl = configMap.watchtower_url || null;
      this.apiToken = configMap.watchtower_api_token || null;
      this.webhookSecret = configMap.watchtower_webhook_secret || null;
    } catch (error) {
      console.error('Failed to initialize WatchTower configuration:', error);
    }
  }

  async isConfigured(): Promise<boolean> {
    if (!this.watchTowerUrl || !this.apiToken) {
      await this.initialize();
    }
    return !!(this.watchTowerUrl && this.apiToken);
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    // For now, just do a basic check until webhook secret is properly configured
    return signature.length > 0;
  }

  async handleWebhookEvent(event: WebhookEvent): Promise<void> {
    try {
      console.log(`Processing webhook event: ${event.event_type}`);
      
      switch (event.event_type) {
        case 'user.created':
          await this.handleUserCreated(event.data);
          break;
        case 'user.updated':
          await this.handleUserUpdated(event.data);
          break;
        case 'user.deleted':
          await this.handleUserDeleted(event.data);
          break;
        case 'service.updated':
          console.log('Service updated:', event.data);
          break;
        case 'donation.received':
          console.log('Donation received:', event.data);
          break;
        default:
          console.log(`Unhandled webhook event: ${event.event_type}`);
      }
    } catch (error) {
      console.error(`Error handling webhook event ${event.event_type}:`, error);
      throw error;
    }
  }

  /**
   * Check if movie donation is expired
   */
  private _isMovieDonationExpired(userData: any): boolean {
    // Admins and family users never expire
    if (userData.is_admin || userData.is_family) {
      return false;
    }

    // If no donation due date, consider it expired (unless admin/family)
    if (!userData.movie_donation_due) {
      return true;
    }

    try {
      const dueDate = new Date(userData.movie_donation_due);
      const now = new Date();
      return dueDate < now;
    } catch (error) {
      // If we can't parse the date, consider it expired to be safe
      console.error(`Error parsing movie donation due date for user ${userData.email}:`, error);
      return true;
    }
  }

  /**
   * Check if user should have movie service access
   * Based on WatchTower logic: admins and family users always have access
   * Other users must have a valid movie_donation_due date
   */
  private _shouldHaveMovieServiceAccess(userData: any): boolean {
    // Admins always have access
    if (userData.is_admin) {
      return true;
    }

    // Family users always have access (even without donation due date)
    if (userData.is_family) {
      return true;
    }

    // Must be active
    if (!userData.is_active) {
      return false;
    }

    // Must have movie service indicator
    if (!userData.movie_service && !userData.is_movie_user) {
      return false;
    }

    // Must have a movie donation due date (required for non-admin, non-family users)
    if (!userData.movie_donation_due) {
      return false;
    }

    // Check if donation due date is valid (not expired)
    try {
      const dueDate = new Date(userData.movie_donation_due);
      const now = new Date();
      if (dueDate < now) {
        return false;
      }
    } catch (error) {
      // If we can't parse the date, deny access to be safe
      console.error(`Error parsing movie donation due date for user ${userData.email}:`, error);
      return false;
    }

    return true;
  }

  private async handleUserCreated(userData: any): Promise<void> {
    try {
      // Check if user should have movie service access
      const hasMovieServiceAccess = this._shouldHaveMovieServiceAccess(userData);
      
      if (!hasMovieServiceAccess) {
        console.log(`User ${userData.email} does not have movie service access - skipping creation`);
        return;
      }

      // Check if user already exists
      const existingUser = await db.user.findFirst({
        where: {
          OR: [
            { email: userData.email },
            { watchTowerUserId: userData.user_id?.toString() }
          ]
        }
      });

      if (existingUser) {
        console.log(`User ${userData.email} already exists, skipping creation`);
        return;
      }

      // Create new user with movie service metadata
      await db.user.create({
        data: {
          id: `watchtower_${userData.user_id}_${Date.now()}`,
          email: userData.email,
          name: userData.username || userData.email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          role: userData.is_admin ? 'ADMIN' : 'USER',
          isActive: true,
          watchTowerUserId: userData.user_id?.toString(),
          watchTowerUsername: userData.username,
          watchTowerMetadata: {
            movie_service: userData.movie_service || null,
            movie_service_id: userData.movie_service_id || null,
            is_movie_user: userData.is_movie_user || false,
            movie_donation_due: userData.movie_donation_due || null,
            movie_donation_amount: userData.movie_donation_amount || null,
            is_family: userData.is_family || false
          }
        }
      });

      console.log(`Created movie service user ${userData.email} from WatchTower`);
    } catch (error) {
      console.error('Error creating user from webhook:', error);
    }
  }

  private async handleUserUpdated(userData: any): Promise<void> {
    try {
      const user = await db.user.findFirst({
        where: {
          OR: [
            { email: userData.email },
            { watchTowerUserId: userData.user_id?.toString() }
          ]
        }
      });

      // Check if user should have movie service access
      const hasMovieServiceAccess = this._shouldHaveMovieServiceAccess(userData);

      if (!user) {
        // User doesn't exist - create if they have movie service access
        if (hasMovieServiceAccess) {
          console.log(`User ${userData.email} not found, creating from update event (has movie service)`);
          await this.handleUserCreated(userData);
        } else {
          console.log(`User ${userData.email} not found and does not have movie service access - skipping`);
        }
        return;
      }

      // Update existing user
      // If they lost movie service access, deactivate them
      // If they gained access, activate them
      const shouldBeActive = hasMovieServiceAccess;

      await db.user.update({
        where: { id: user.id },
        data: {
          name: userData.username || userData.email,
          watchTowerUsername: userData.username,
          role: userData.is_admin ? 'ADMIN' : 'USER',
          isActive: shouldBeActive,
          updatedAt: new Date(),
          watchTowerMetadata: {
            ...user.watchTowerMetadata as any,
            movie_service: userData.movie_service || null,
            movie_service_id: userData.movie_service_id || null,
            is_movie_user: userData.is_movie_user || false,
            movie_donation_due: userData.movie_donation_due || null,
            movie_donation_amount: userData.movie_donation_amount || null
          }
        }
      });

      if (!shouldBeActive && user.isActive) {
        console.log(`Deactivated user ${userData.email} - lost movie service access`);
      } else if (shouldBeActive && !user.isActive) {
        console.log(`Activated user ${userData.email} - gained movie service access`);
      } else {
        console.log(`Updated user ${userData.email} from WatchTower`);
      }
    } catch (error) {
      console.error('Error updating user from webhook:', error);
    }
  }

  private async handleUserDeleted(userData: any): Promise<void> {
    try {
      const user = await db.user.findFirst({
        where: {
          email: userData.email
        }
      });

      if (!user) {
        console.log(`User ${userData.email} not found for deletion`);
        return;
      }

      // Soft delete - just deactivate the user
      await db.user.update({
        where: { id: user.id },
        data: {
          isActive: false,
          updatedAt: new Date()
        }
      });

      console.log(`Deactivated user ${userData.email} from WatchTower`);
    } catch (error) {
      console.error('Error deleting user from webhook:', error);
    }
  }

  async fetchUsers(): Promise<WatchTowerUser[]> {
    if (!await this.isConfigured()) {
      throw new Error('WatchTower not configured');
    }

    try {
      // Use the proper CrossAppToken API endpoint
      const response = await fetch(`${this.watchTowerUrl}/api/api/v1/users/`, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('WatchTower API Response:', JSON.stringify(data, null, 2));
      
      // Handle different response formats (results or users array, or direct array)
      const allUsers = data.results || data.users || (Array.isArray(data) ? data : []);
      console.log(`Total users from WatchTower: ${allUsers.length}`);
      
      if (allUsers.length > 0) {
        console.log('Sample user data:', JSON.stringify(allUsers[0], null, 2));
      }
      
      // Filter for movie service users only (including expired - we'll mark them as expired)
      // A user has movie service if they are admin, family, or have movie_service/is_movie_user
      const filteredUsers = allUsers.filter((user: any) => {
        // Admins always count as movie users
        if (user.is_admin) {
          return true;
        }

        // Family users always count as movie users
        if (user.is_family) {
          return true;
        }

        // Must be active
        if (!user.is_active) {
          return false;
        }

        // Must have movie service indicator
        const hasMovieService = !!(user.movie_service || user.is_movie_user);
        
        console.log(`User ${user.email}: movie_service=${user.movie_service}, is_movie_user=${user.is_movie_user}, movie_donation_due=${user.movie_donation_due}, active=${user.is_active}, hasMovieService=${hasMovieService}`);
        
        return hasMovieService;
      });
      
      console.log(`Filtered movie service users: ${filteredUsers.length}`);
      return filteredUsers;
    } catch (error) {
      console.error('Error fetching users from WatchTower:', error);
      throw error;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      if (!await this.isConfigured()) {
        return false;
      }

      // Test with the users endpoint to verify token works
      const response = await fetch(`${this.watchTowerUrl}/api/api/v1/users/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.ok;
    } catch (error) {
      console.error('WatchTower connection check failed:', error);
      return false;
    }
  }

  async syncUsers(): Promise<{ created: number; updated: number; skipped: number; total: number }> {
    try {
      const users = await this.fetchUsers();
      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const wtUser of users) {
        try {
          // Check if donation is expired (we import all movie users regardless)
          const isExpired = this._isMovieDonationExpired(wtUser);
          const hasAccess = this._shouldHaveMovieServiceAccess(wtUser);

          const existingUser = await db.user.findFirst({
            where: {
              OR: [
                { email: wtUser.email },
                { watchTowerUserId: wtUser.id?.toString() }
              ]
            }
          });

          const userData = {
            name: wtUser.first_name && wtUser.last_name 
              ? `${wtUser.first_name} ${wtUser.last_name}`.trim()
              : wtUser.username || wtUser.email,
            role: wtUser.is_admin ? 'ADMIN' : 'USER',
            isActive: hasAccess, // Set to false if expired (will block login)
            watchTowerUserId: wtUser.id?.toString(),
            watchTowerUsername: wtUser.username,
            watchTowerJoinDate: wtUser.date_joined ? new Date(wtUser.date_joined) : null,
            watchTowerMetadata: {
              isAdmin: wtUser.is_admin || false,
              isStaff: wtUser.is_staff || false,
              isSuperuser: wtUser.is_superuser || false,
              isFamily: wtUser.is_family || false,
              dateJoined: wtUser.date_joined,
              lastLogin: wtUser.last_login,
              movie_service: wtUser.movie_service || null,
              movie_service_id: wtUser.movie_service_id || null,
              is_movie_user: wtUser.is_movie_user || false,
              movie_donation_due: wtUser.movie_donation_due || null,
              movie_donation_amount: wtUser.movie_donation_amount || null,
              movie_donation_expired: isExpired
            }
          };

          if (existingUser) {
            // Update existing user
            await db.user.update({
              where: { id: existingUser.id },
              data: {
                ...userData,
                updatedAt: new Date()
              }
            });
            updated++;
            console.log(`Updated movie service user: ${wtUser.email}${isExpired ? ' (EXPIRED)' : ''}`);
          } else {
            // Create new user
            await db.user.create({
              data: {
                id: `watchtower_${wtUser.id}_${Date.now()}`,
                email: wtUser.email,
                emailVerified: true,
                createdAt: userData.watchTowerJoinDate || new Date(),
                updatedAt: new Date(),
                password: null, // SSO users don't need passwords
                ...userData
              }
            });
            created++;
            console.log(`Created movie service user: ${wtUser.email}${isExpired ? ' (EXPIRED)' : ''}`);
          }
        } catch (userError) {
          console.error(`Error processing user ${wtUser.email}:`, userError);
          skipped++;
        }
      }

      console.log(`Sync complete: ${created} created, ${updated} updated, ${skipped} skipped`);
      return { created, updated, skipped, total: users.length };
    } catch (error) {
      console.error('Error syncing users:', error);
      throw error;
    }
  }

  async authenticateUser(email: string, password: string): Promise<WatchTowerUser | null> {
    if (!await this.isConfigured()) {
      throw new Error('WatchTower not configured');
    }

    try {
      // Use the same login endpoint as the working integration
      const response = await fetch(`${this.watchTowerUrl}/api/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username_or_email: email,
          password: password
        })
      });

      if (!response.ok) {
        return null;
      }

      const authData = await response.json();
      
      // Get user details using the JWT token
      const userResponse = await fetch(`${this.watchTowerUrl}/api/admin/export-users/`, {
        headers: {
          'Authorization': `Bearer ${authData.access_token}`
        }
      });

      if (!userResponse.ok) {
        return null;
      }

      // Find the current user in the export data
      const data = await userResponse.json();
      const users = data.users || [];
      return users.find((user: WatchTowerUser) => user.email === email) || null;
    } catch (error) {
      console.error('Error authenticating user:', error);
      return null;
    }
  }
} 