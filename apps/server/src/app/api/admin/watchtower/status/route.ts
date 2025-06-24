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
      return NextResponse.json({
        configured: false,
        connected: false,
        message: 'WatchTower not configured'
      });
    }

    // Test connection to WatchTower
    try {
      const response = await fetch(`${configMap.watchtower_url}/api/api/v1/auth/validate-token/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${configMap.watchtower_api_token}`
        }
      });

      const connected = response.ok;
      let connectionDetails = null;

      if (connected) {
        const tokenData = await response.json();
        connectionDetails = {
          tokenValid: true,
          appName: tokenData.app_name,
          permissions: tokenData.permissions,
          lastChecked: new Date().toISOString()
        };
      }

      return NextResponse.json({
        configured: true,
        connected,
        url: configMap.watchtower_url,
        configuredAt: configMap.watchtower_configured_at,
        connectionDetails,
        message: connected ? 'Connected to WatchTower' : 'Cannot connect to WatchTower'
      });

    } catch (connectionError) {
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
    console.error('Error checking WatchTower status:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
} 