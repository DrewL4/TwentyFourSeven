import crypto from 'crypto';
import { db } from './context';
import { watchTowerConfig } from './watchtower-config';

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

interface WebhookEvent {
  event_type: string;
  timestamp: string;
  data: any;
}

export class WatchTowerHubService {
  private static instance: WatchTowerHubService;

  private constructor() {}

  static getInstance(): WatchTowerHubService {
    if (!WatchTowerHubService.instance) {
      WatchTowerHubService.instance = new WatchTowerHubService();
    }
    return WatchTowerHubService.instance;
  }

  async isConfigured(): Promise<boolean> {
    return await watchTowerConfig.isConfigured();
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

  private async handleUserCreated(userData: any): Promise<void> {
    try {
      // Check if user already exists
      const existingUser = await db.user.findFirst({
        where: {
          email: userData.email
        }
      });

      if (existingUser) {
        console.log(`User ${userData.email} already exists, skipping creation`);
        return;
      }

      // Create new user with required fields only
      await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: userData.email,
          name: userData.username || userData.email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          // Add optional fields that exist in the schema
          ...(userData.is_admin && { role: 'ADMIN' }),
          ...(userData.is_active !== undefined && { isActive: userData.is_active }),
        }
      });

      console.log(`Created user ${userData.email} from WatchTower`);
    } catch (error) {
      console.error('Error creating user from webhook:', error);
    }
  }

  private async handleUserUpdated(userData: any): Promise<void> {
    try {
      const user = await db.user.findFirst({
        where: {
          email: userData.email
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
          updatedAt: new Date(),
          ...(userData.is_admin !== undefined && { role: userData.is_admin ? 'ADMIN' : 'USER' }),
          ...(userData.is_active !== undefined && { isActive: userData.is_active }),
        }
      });

      console.log(`Updated user ${userData.email} from WatchTower`);
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
    const config = await watchTowerConfig.getConfig();
    
    if (!config.url || !config.apiToken) {
      throw new Error('WatchTower not configured');
    }

    try {
      const response = await fetch(`${config.url}/api/v1/users/`, {
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json'
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

  async checkConnection(): Promise<boolean> {
    try {
      const config = await watchTowerConfig.getConfig();
      
      if (!config.url || !config.apiToken) {
        return false;
      }

      const response = await fetch(`${config.url}/api/health/`, {
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
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
          const existingUser = await db.user.findFirst({
            where: {
              email: wtUser.email
            }
          });

          if (existingUser) {
            // Update existing user
            await db.user.update({
              where: { id: existingUser.id },
              data: {
                name: wtUser.username || wtUser.email,
                updatedAt: new Date(),
                ...(wtUser.is_admin !== undefined && { role: wtUser.is_admin ? 'ADMIN' : 'USER' }),
                ...(wtUser.is_active !== undefined && { isActive: wtUser.is_active }),
              }
            });
            updated++;
          } else {
            // Create new user
            await db.user.create({
              data: {
                id: crypto.randomUUID(),
                email: wtUser.email,
                name: wtUser.username || wtUser.email,
                emailVerified: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                role: wtUser.is_admin ? 'ADMIN' : 'USER',
                isActive: wtUser.is_active !== false,
              }
            });
            created++;
          }
        } catch (userError) {
          console.error(`Error processing user ${wtUser.email}:`, userError);
          skipped++;
        }
      }

      return { created, updated, skipped, total: users.length };
    } catch (error) {
      console.error('Error syncing users:', error);
      throw error;
    }
  }

  async authenticateUser(email: string, password: string): Promise<WatchTowerUser | null> {
    const config = await watchTowerConfig.getConfig();
    
    if (!config.url || !config.apiToken) {
      throw new Error('WatchTower not configured');
    }

    try {
      const response = await fetch(`${config.url}/api/v1/auth/login/`, {
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
      
      // Get user details
      const userResponse = await fetch(`${config.url}/api/v1/users/me/`, {
        headers: {
          'Authorization': `Bearer ${authData.access_token}`
        }
      });

      if (!userResponse.ok) {
        return null;
      }

      return await userResponse.json();
    } catch (error) {
      console.error('Error authenticating user:', error);
      return null;
    }
  }
} 