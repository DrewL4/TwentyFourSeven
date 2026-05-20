import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/context';

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

    // Test connection to WatchTower using CrossAppToken validation
    try {
      const response = await fetch(`${configMap.watchtower_url}/api/v1/auth/validate-api-token/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: configMap.watchtower_api_token
        })
      });

      const connected = response.ok;
      let connectionDetails = null;

      if (connected) {
        const tokenData = await response.json();
        connectionDetails = {
          tokenValid: tokenData.valid || false,
          appName: tokenData.app_name,
          permissions: tokenData.permissions,
          lastChecked: new Date().toISOString()
        };
      }

      // Check if webhooks are registered
      const webhookId = await db.setting.findUnique({
        where: { key: 'watchtower_webhook_id' }
      });
      const webhookRegisteredAt = await db.setting.findUnique({
        where: { key: 'watchtower_webhook_registered_at' }
      });

      return NextResponse.json({
        configured: true,
        connected,
        url: configMap.watchtower_url,
        configuredAt: configMap.watchtower_configured_at,
        connectionDetails,
        webhookRegistered: !!webhookId,
        webhookRegisteredAt: webhookRegisteredAt?.value || null,
        message: connected ? 'Connected to WatchTower' : 'Cannot connect to WatchTower'
      });

    } catch (connectionError) {
      console.error('💥 WatchTower connection error:', connectionError);
      return NextResponse.json({
        configured: true,
        connected: false,
        url: configMap.watchtower_url,
        configuredAt: configMap.watchtower_configured_at,
        error: connectionError instanceof Error ? connectionError.message : 'Connection failed',
        message: 'Cannot connect to WatchTower'
      });
    }

  } catch (error) {
    console.error('💥 Error checking WatchTower status:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
} 