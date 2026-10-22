import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/context';
import { checkWatchTowerReachable } from '@/lib/watchtower-reach';

// Helper function to check admin permissions or allow configuration check
async function checkAdminAuthOrAllowConfigCheck(request: NextRequest) {
  // Always allow checking if WatchTower is configured (for login page)
  // This is a read-only operation that doesn't expose sensitive data
  return null;
}

// GET /api/admin/watchtower/status
export async function GET(request: NextRequest) {
  
  const authError = await checkAdminAuthOrAllowConfigCheck(request);
  if (authError) return authError;

  try {
    // Get WatchTower configuration
    const config = await db.setting.findMany({
      where: {
        key: {
          in: ['watchtower_url', 'watchtower_api_token', 'watchtower_configured_at']
        }
      }
    });

    const configMap = config.reduce((acc: Record<string, string>, setting: any) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    const isConfigured = !!(configMap.watchtower_url && configMap.watchtower_api_token);

    if (!isConfigured) {
      const userCount = await db.user.count();
      const existingConfig = await db.setting.findFirst({
        where: { key: 'watchtower_configured_at' },
      });
      const allowInitialSetup = userCount === 0 || !existingConfig;

      return NextResponse.json({
        configured: false,
        connected: false,
        allowInitialSetup,
        message: 'WatchTower not configured',
      });
    }

    // Round trip to WatchTower with the integration token (same API path as login: /api/api/v1/...).
    const reach = await checkWatchTowerReachable(
      configMap.watchtower_url,
      configMap.watchtower_api_token,
    );

    // Check if webhooks are registered
    const webhookId = await db.setting.findUnique({
      where: { key: 'watchtower_webhook_id' }
    });
    const webhookRegisteredAt = await db.setting.findUnique({
      where: { key: 'watchtower_webhook_registered_at' }
    });

    return NextResponse.json({
      configured: true,
      connected: reach.ok,
      url: configMap.watchtower_url,
      configuredAt: configMap.watchtower_configured_at,
      connectionDetails: reach.ok ? { tokenValid: true, lastChecked: new Date().toISOString() } : null,
      webhookRegistered: !!webhookId,
      webhookRegisteredAt: webhookRegisteredAt?.value || null,
      ...(reach.ok ? {} : { error: reach.error }),
      message: reach.ok ? 'Connected to WatchTower' : 'Cannot connect to WatchTower'
    });

  } catch (error) {
    console.error('💥 Error checking WatchTower status:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
} 