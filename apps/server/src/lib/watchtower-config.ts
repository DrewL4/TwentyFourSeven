import fs from 'fs/promises';
import path from 'path';

interface WatchTowerConfig {
  url?: string;
  apiToken?: string;
  webhookSecret?: string;
  lastSync?: string;
  isConnected?: boolean;
}

class WatchTowerConfigService {
  private static instance: WatchTowerConfigService;
  private configPath: string;
  private config: WatchTowerConfig = {};

  private constructor() {
    this.configPath = path.join(process.cwd(), '.watchtower-config.json');
  }

  static getInstance(): WatchTowerConfigService {
    if (!WatchTowerConfigService.instance) {
      WatchTowerConfigService.instance = new WatchTowerConfigService();
    }
    return WatchTowerConfigService.instance;
  }

  async loadConfig(): Promise<WatchTowerConfig> {
    try {
      // Try to load from file first
      const fileContent = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(fileContent);
    } catch (error) {
      // If file doesn't exist, use environment variables
      this.config = {
        url: process.env.WATCHTOWER_URL,
        apiToken: process.env.WATCHTOWER_API_TOKEN,
        webhookSecret: process.env.WATCHTOWER_WEBHOOK_SECRET,
        isConnected: false
      };
    }
    return this.config;
  }

  async saveConfig(config: Partial<WatchTowerConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save WatchTower config:', error);
    }
  }

  async getConfig(): Promise<WatchTowerConfig> {
    if (Object.keys(this.config).length === 0) {
      await this.loadConfig();
    }
    return this.config;
  }

  async isConfigured(): Promise<boolean> {
    const config = await this.getConfig();
    return !!(config.url && config.apiToken);
  }

  async clearConfig(): Promise<void> {
    this.config = {};
    try {
      await fs.unlink(this.configPath);
    } catch (error) {
      // File might not exist, ignore error
    }
  }
}

export const watchTowerConfig = WatchTowerConfigService.getInstance(); 