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
  date_joined?: string;
  last_login?: string;
  profile?: any;
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

      // Create new user
      await db.user.create({
        data: {
          id: `watchtower_${userData.user_id}_${Date.now()}`,
          email: userData.email,
          name: userData.username || userData.email,
          watchTowerUserId: userData.user_id?.toString(),
          watchTowerUsername: userData.username,
          role: userData.is_admin ? 'ADMIN' : 'USER',
          isActive: userData.is_active !== false,
          password: `watchtower_sso_${Date.now()}`, // Placeholder
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          watchTowerMetadata: {
            services: userData.services || [],
            tvDonationDue: userData.tv_donation_due,
            movieDonationDue: userData.movie_donation_due
          }
        }
      });

      console.log(`Created user ${userData.email} from WatchTower`);
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

      if (!user) {
        console.log(`User ${userData.email} not found, creating from update event`);
        await this.handleUserCreated(userData);
        return;
      }

      // Update existing user
      await db.user.update({
        where: { id: user.id },
        data: {
          name: userData.username || userData.email,
          watchTowerUsername: userData.username,
          role: userData.is_admin ? 'ADMIN' : 'USER',
          isActive: userData.is_active !== false,
          updatedAt: new Date(),
          watchTowerMetadata: {
            ...user.watchTowerMetadata as any,
            services: userData.services || [],
            tvDonationDue: userData.tv_donation_due,
            movieDonationDue: userData.movie_donation_due
          }
        }
      });

      console.log(`Updated user ${userData.email} from WatchTower`);
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

  async fetchUsers(): Promise<WatchTowerUser[]> {
    if (!await this.isConfigured()) {
      throw new Error('WatchTower not configured');
    }

    try {
      const response = await fetch(`${this.watchTowerUrl}/api/v1/users/`, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.statusText}`);
      }

      const data = await response.json();
      return data.results || data;
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
      const response = await fetch(`${this.watchTowerUrl}/api/v1/auth/login/`, {
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
      const userResponse = await fetch(`${this.watchTowerUrl}/api/v1/users/me/`, {
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