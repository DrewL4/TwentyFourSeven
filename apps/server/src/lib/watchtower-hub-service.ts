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

interface WatchTowerService {
  id: number;
  name: string;
  type: string;
  playlist_url: string | null;
  epg_url: string | null;
  plex_url: string | null;
  panel_url: string | null;
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
    if (!this.webhookSecret) {
      console.error('No webhook secret configured');
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      const expectedSigWithPrefix = `sha256=${expectedSignature}`;
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSigWithPrefix)
      );
    } catch (error) {
      console.error('Error verifying webhook signature:', error);
      return false;
    }
  }

  async handleWebhookEvent(event: WebhookEvent): Promise<void> {
    try {
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
          await this.handleServiceUpdated(event.data);
          break;
        case 'donation.received':
          await this.handleDonationReceived(event.data);
          break;
        default:
          console.log(`Unhandled webhook event: ${event.event_type}`);
      }
    } catch (error) {
      console.error(`Error handling webhook event ${event.event_type}:`, error);
      throw error;
    }
  }

  private async handleUserCreated(userData: any): Promise<void> {
    try {
      // Check if user has movie service (regardless of expiration)
      const hasMovieService = !!(userData.movie_service || userData.is_movie_user || userData.is_admin || userData.is_family);
      
      if (!hasMovieService) {
        console.log(`User ${userData.email} does not have movie service - skipping creation`);
        return;
      }

      // Check if donation is expired
      const isExpired = this._isMovieDonationExpired(userData);
      const hasAccess = this._shouldHaveMovieServiceAccess(userData);

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

      // Create new user with movie service metadata (including expired users)
      await db.user.create({
        data: {
          id: `watchtower_${userData.user_id}_${Date.now()}`,
          email: userData.email,
          name: userData.username || userData.email,
          watchTowerUserId: userData.user_id?.toString(),
          watchTowerUsername: userData.username,
          role: userData.is_admin ? 'ADMIN' : 'USER',
          isActive: hasAccess, // Set to false if expired (will block login)
          password: `watchtower_sso_${Date.now()}`, // Placeholder
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          watchTowerMetadata: {
            services: userData.services || [],
            tvDonationDue: userData.tv_donation_due,
            movieDonationDue: userData.movie_donation_due,
            movie_service: userData.movie_service || null,
            movie_service_id: userData.movie_service_id || null,
            is_movie_user: userData.is_movie_user || false,
            movie_donation_amount: userData.movie_donation_amount || null,
            movie_donation_due: userData.movie_donation_due || null,
            movie_donation_expired: isExpired,
            is_family: userData.is_family || false
          }
        }
      });

      console.log(`Created movie service user ${userData.email} from WatchTower${isExpired ? ' (EXPIRED)' : ''}`);
      
      // Emit Socket.io event
      try {
        const { emitUserUpdate } = await import('@/lib/socket-io');
        emitUserUpdate(userData.email, 'created');
      } catch (error) {
        // Socket.io might not be initialized, that's okay
      }
    } catch (error) {
      console.error('Error creating user from webhook:', error);
      throw error;
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

      // Check if user has movie service (regardless of expiration)
      const hasMovieService = !!(userData.movie_service || userData.is_movie_user || userData.is_admin || userData.is_family);
      const isExpired = this._isMovieDonationExpired(userData);
      const hasMovieServiceAccess = this._shouldHaveMovieServiceAccess(userData);

      if (!user) {
        // User doesn't exist - create if they have movie service (including expired)
        if (hasMovieService) {
          console.log(`User ${userData.email} not found, creating from update event (has movie service)`);
          await this.handleUserCreated(userData);
        } else {
          console.log(`User ${userData.email} not found and does not have movie service - skipping`);
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
            services: userData.services || [],
            tvDonationDue: userData.tv_donation_due,
            movieDonationDue: userData.movie_donation_due,
            movie_service: userData.movie_service || null,
            movie_service_id: userData.movie_service_id || null,
            is_movie_user: userData.is_movie_user || false,
            movie_donation_amount: userData.movie_donation_amount || null,
            movie_donation_due: userData.movie_donation_due || null,
            movie_donation_expired: isExpired,
            is_family: userData.is_family || false
          }
        }
      });

      if (!shouldBeActive && user.isActive) {
        console.log(`[Webhook] Deactivated user ${userData.email} - lost movie service access`);
        // Emit Socket.io event
        try {
          const { emitUserUpdate } = await import('@/lib/socket-io');
          emitUserUpdate(userData.email, 'updated');
        } catch (error) {
          // Socket.io might not be initialized, that's okay
        }
      } else if (shouldBeActive && !user.isActive) {
        console.log(`[Webhook] Activated user ${userData.email} - gained movie service access${isExpired ? ' (was expired, now active)' : ''}`);
        // Emit Socket.io event
        try {
          const { emitUserUpdate } = await import('@/lib/socket-io');
          emitUserUpdate(userData.email, 'updated');
        } catch (error) {
          // Socket.io might not be initialized, that's okay
        }
      } else if (isExpired !== (user.watchTowerMetadata as any)?.movie_donation_expired) {
        console.log(`[Webhook] Updated user ${userData.email} expiration status: ${isExpired ? 'EXPIRED' : 'ACTIVE'}`);
        // Emit Socket.io event
        try {
          const { emitUserUpdate } = await import('@/lib/socket-io');
          emitUserUpdate(userData.email, 'updated');
        } catch (error) {
          // Socket.io might not be initialized, that's okay
        }
      } else {
        console.log(`[Webhook] Updated user ${userData.email} from WatchTower`);
        // Emit Socket.io event for any update
        try {
          const { emitUserUpdate } = await import('@/lib/socket-io');
          emitUserUpdate(userData.email, 'updated');
        } catch (error) {
          // Socket.io might not be initialized, that's okay
        }
      }
    } catch (error) {
      console.error('Error updating user from webhook:', error);
      throw error;
    }
  }

  private async handleUserDeleted(userData: any): Promise<void> {
    try {
      const user = await db.user.findFirst({
        where: {
          OR: [
            { email: userData.email },
            { watchTowerUserId: userData.user_id?.toString() }
          ]
        }
      });

      if (!user) {
        console.log(`User ${userData.email} not found for deletion`);
        return;
      }

      // Option 1: Soft delete (clear WatchTower data but keep account)
      await db.user.update({
        where: { id: user.id },
        data: {
          watchTowerUserId: null,
          watchTowerUsername: null,
          watchTowerMetadata: undefined,
          isActive: false,
          updatedAt: new Date()
        }
      });

      // Option 2: Hard delete (uncomment if preferred)
      // await db.user.delete({
      //   where: { id: user.id }
      // });

      console.log(`Soft deleted user ${userData.email} from WatchTower`);
      
      // Emit Socket.io event
      try {
        const { emitUserUpdate } = await import('@/lib/socket-io');
        emitUserUpdate(userData.email, 'deleted');
      } catch (error) {
        // Socket.io might not be initialized, that's okay
      }
    } catch (error) {
      console.error('Error deleting user from webhook:', error);
      throw error;
    }
  }

  private async handleServiceUpdated(serviceData: any): Promise<void> {
    try {
              // Store service update in settings or logs for admin review
        await db.setting.upsert({
          where: { key: `watchtower_service_${serviceData.service_id}_update` },
          update: { 
            value: JSON.stringify({
              ...serviceData,
              lastUpdated: new Date().toISOString()
            })
          },
          create: {
            key: `watchtower_service_${serviceData.service_id}_update`,
            value: JSON.stringify({
              ...serviceData,
              lastUpdated: new Date().toISOString()
            })
          }
        });

      console.log(`Logged service update for service ${serviceData.service_id}`);
    } catch (error) {
      console.error('Error handling service update webhook:', error);
      throw error;
    }
  }

  private async handleDonationReceived(donationData: any): Promise<void> {
    try {
      // Find the user and update their access/permissions based on donation
      const user = await db.user.findFirst({
        where: {
          OR: [
            { watchTowerUserId: donationData.user_id?.toString() },
            { email: donationData.username } // Fallback if username is email
          ]
        }
      });

      if (!user) {
        console.log(`User not found for donation: ${donationData.username}`);
        return;
      }

              // Log the donation for admin review
        await db.setting.create({
          data: {
            key: `watchtower_donation_${donationData.donation_id}`,
            value: JSON.stringify({
              ...donationData,
              twentyFourSevenUserId: user.id,
              processedAt: new Date().toISOString()
            })
          }
        });

      console.log(`Logged donation for user ${user.email}: ${donationData.amount}`);
    } catch (error) {
      console.error('Error handling donation webhook:', error);
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
   * Check if user should have movie service access based on WatchTower data
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
      console.log(`User ${userData.email} has family access - granting movie service access`);
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
      console.log(`User ${userData.email} has no movie donation due date - denying access`);
      return false;
    }

    // Check if donation due date is valid (not expired)
    try {
      const dueDate = new Date(userData.movie_donation_due);
      const now = new Date();
      if (dueDate < now) {
        console.log(`Movie donation expired for user ${userData.email}: ${userData.movie_donation_due}`);
        return false;
      }
    } catch (error) {
      // If we can't parse the date, deny access to be safe
      console.error(`Error parsing movie donation due date for user ${userData.email}:`, error);
      return false;
    }

    return true;
  }

  async fetchUsers(): Promise<WatchTowerUser[]> {
    if (!await this.isConfigured()) {
      throw new Error('WatchTower not configured');
    }

    try {
      // Fix URL pattern: use /api/api/v1/ instead of /api/v1/
      const response = await fetch(`${this.watchTowerUrl}/api/api/v1/users/`, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.statusText}`);
      }

      const data = await response.json();
      const allUsers = data.results || data;
      
      // Filter to only users with movie services
      return Array.isArray(allUsers) 
        ? allUsers.filter((user: any) => user.movie_service || user.is_movie_user)
        : [];
    } catch (error) {
      console.error('Error fetching users from WatchTower:', error);
      throw error;
    }
  }

  async authenticateUser(email: string, password: string): Promise<WatchTowerUser | null> {
    if (!await this.isConfigured()) {
      throw new Error('WatchTower not configured');
    }

    try {
      // Fix URL pattern: use /api/api/v1/ instead of /api/v1/
      const response = await fetch(`${this.watchTowerUrl}/api/api/v1/auth/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        return null;
      }

      const authData = await response.json();

      // Get user details
      // Fix URL pattern: use /api/api/v1/ instead of /api/v1/
      const userResponse = await fetch(`${this.watchTowerUrl}/api/api/v1/users/me/`, {
        headers: {
          'Authorization': `Bearer ${authData.access_token}`
        }
      });

      if (!userResponse.ok) {
        return null;
      }

      return await userResponse.json();
    } catch (error) {
      console.error('Error authenticating user with WatchTower:', error);
      return null;
    }
  }
} 