import { prisma } from "@/lib/prisma";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

interface WatchTowerSettings {
  watchTowerEnabled: boolean;
  watchTowerUrl: string;
  watchTowerUsername: string;
  watchTowerPassword: string;
  watchTowerAutoSync: boolean;
  watchTowerSyncInterval: number;
  watchTowerLastSync: Date | null;
}

// Simple encryption for passwords (use environment variable in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'twentyfourseven-secret-key-12345';
const ALGORITHM = 'aes-256-cbc';

function encryptPassword(password: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptPassword(encryptedPassword: string): string {
  const [ivHex, encrypted] = encryptedPassword.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export class WatchTowerService {
  private static instance: WatchTowerService;
  
  public static getInstance(): WatchTowerService {
    if (!WatchTowerService.instance) {
      WatchTowerService.instance = new WatchTowerService();
    }
    return WatchTowerService.instance;
  }

  async getSettings(): Promise<WatchTowerSettings | null> {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" }
    });

    if (!settings || !settings.watchTowerEnabled) {
      return null;
    }

    return {
      watchTowerEnabled: settings.watchTowerEnabled,
      watchTowerUrl: settings.watchTowerUrl,
      watchTowerUsername: settings.watchTowerUsername,
      watchTowerPassword: settings.watchTowerPassword,
      watchTowerAutoSync: settings.watchTowerAutoSync,
      watchTowerSyncInterval: settings.watchTowerSyncInterval,
      watchTowerLastSync: settings.watchTowerLastSync,
    };
  }

  // Encrypt password for storage
  encryptPassword(password: string): string {
    return encryptPassword(password);
  }

  // Decrypt password for API calls
  decryptPassword(encryptedPassword: string): string | null {
    try {
      return decryptPassword(encryptedPassword);
    } catch (error) {
      console.error('Failed to decrypt password:', error);
      return null;
    }
  }

  async loginToWatchTower(url: string, username: string, password: string) {
    const loginResponse = await fetch(`${url}/api/login/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        username_or_email: username,
        password: password,
      }),
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
    }

    const loginData = await loginResponse.json();
    if (!loginData.access_token) {
      throw new Error("No access token received from WatchTower login");
    }

    return loginData.access_token;
  }

  async fetchUsers(url: string, accessToken: string) {
    const usersResponse = await fetch(`${url}/api/admin/export-users/`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      credentials: "include",
    });

    if (!usersResponse.ok) {
      throw new Error(`Failed to fetch users: ${usersResponse.status} ${usersResponse.statusText}`);
    }

    const usersData = await usersResponse.json();
    return usersData.users || [];
  }

  async syncUsers(): Promise<{ created: number; updated: number; skipped: number; total: number }> {
    const settings = await this.getSettings();
    if (!settings) {
      throw new Error("WatchTower is not configured");
    }

    // Decrypt password for API calls
    const decryptedPassword = this.decryptPassword(settings.watchTowerPassword);
    if (!decryptedPassword) {
      throw new Error("Failed to decrypt WatchTower password. Please re-configure your WatchTower settings.");
    }

    // Login and fetch users
    const accessToken = await this.loginToWatchTower(
      settings.watchTowerUrl,
      settings.watchTowerUsername,
      decryptedPassword
    );

    const tvUsers = await this.fetchUsers(settings.watchTowerUrl, accessToken);

    // Import users
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const wtUser of tvUsers) {
      if (!wtUser.tv_service || !wtUser.is_active) continue;

      try {
        const userData = {
          name: `${wtUser.first_name} ${wtUser.last_name}`.trim() || wtUser.username,
          email: wtUser.email,
          emailVerified: false,
          source: 'watchtower_sync',
          originalJoinDate: wtUser.date_joined // Pass the WatchTower join date
        };

        const importResponse = await fetch("/api/admin/import-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(userData),
        });

        if (importResponse.ok) {
          const result = await importResponse.json();
          if (result.action === "created") {
            created++;
          } else if (result.action === "updated") {
            updated++;
          }
        } else {
          skipped++;
        }
      } catch (error) {
        skipped++;
      }
    }

    // Update last sync time
    await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        watchTowerLastSync: new Date(),
        updatedAt: new Date(),
      }
    });

    return { created, updated, skipped, total: tvUsers.length };
  }
} 