import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from "@/lib/context";

// Helper function to check admin permissions
async function checkAdminAuth(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if user is admin
  const user = await db.user.findUnique({
    where: { id: session.user.id }
  });

  if (user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  }

  return null;
}

// Helper function to get WatchTower config
async function getWatchTowerConfig() {
  const config = await db.setting.findMany({
    where: {
      key: {
        in: ['watchtower_url', 'watchtower_api_token', 'watchtower_webhook_secret']
      }
    }
  });

  const configMap = config.reduce((acc, setting) => {
    acc[setting.key] = setting.value;
    return acc;
  }, {} as Record<string, string>);

  return {
    url: configMap.watchtower_url,
    apiToken: configMap.watchtower_api_token,
    webhookSecret: configMap.watchtower_webhook_secret
  };
}

// Helper function to save WatchTower config
async function saveWatchTowerConfig(url: string, apiToken: string, webhookSecret?: string) {
  const settings = [
    { key: 'watchtower_url', value: url },
    { key: 'watchtower_api_token', value: apiToken }
  ];

  if (webhookSecret) {
    settings.push({ key: 'watchtower_webhook_secret', value: webhookSecret });
  }

  for (const setting of settings) {
    await db.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting
    });
  }
}

// GET /api/admin/watchtower/status
export async function GET(request: NextRequest) {
  const authError = await checkAdminAuth(request);
  if (authError) return authError;

  try {
    const config = await getWatchTowerConfig();
    
    if (!config.url || !config.apiToken) {
      return NextResponse.json({
        isConnected: false,
        watchTowerUrl: null,
        lastSync: null,
        userCount: 0
      });
    }

    // Test connection to WatchTower
    try {
      const response = await fetch(`${config.url}/api/api/v1/auth/validate-token/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiToken}`
        }
      });

      if (!response.ok) {
        return NextResponse.json({
          isConnected: false,
          watchTowerUrl: config.url,
          lastSync: null,
          userCount: 0,
          errors: ['Invalid API token or WatchTower unreachable']
        });
      }

      // Get user count
      const userCount = await db.user.count({
        where: { 
          watchTowerUserId: { not: null }
        }
      });

      // Get last sync time
      const lastSyncSetting = await db.setting.findUnique({
        where: { key: 'watchtower_last_sync' }
      });

      return NextResponse.json({
        isConnected: true,
        watchTowerUrl: config.url,
        lastSync: lastSyncSetting?.value || null,
        userCount
      });

    } catch (error) {
      return NextResponse.json({
        isConnected: false,
        watchTowerUrl: config.url,
        lastSync: null,
        userCount: 0,
        errors: ['Connection test failed']
      });
    }

  } catch (error) {
    console.error('Error checking WatchTower status:', error);
    return NextResponse.json(
      { error: 'Failed to check connection status' },
      { status: 500 }
    );
  }
} 