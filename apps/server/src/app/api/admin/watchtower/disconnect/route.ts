import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/context';

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

// POST /api/admin/watchtower/disconnect
export async function POST(request: NextRequest) {
  const authError = await checkAdminAuth(request);
  if (authError) return authError;

  try {
    // Get current WatchTower config to attempt webhook deregistration
    const config = await db.setting.findMany({
      where: {
        key: {
          in: ['watchtower_url', 'watchtower_api_token', 'watchtower_webhook_id']
        }
      }
    });

    const configMap = config.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string>);

    // Attempt to deregister webhook from WatchTower
    if (configMap.watchtower_url && configMap.watchtower_api_token && configMap.watchtower_webhook_id) {
      try {
        await fetch(`${configMap.watchtower_url}/api/api/v1/webhooks/${configMap.watchtower_webhook_id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${configMap.watchtower_api_token}`
          }
        });
      } catch (error) {
        console.warn('Failed to deregister webhook from WatchTower:', error);
        // Continue with disconnect even if webhook deregistration fails
      }
    }

    // Remove all WatchTower configuration
    const settingsToRemove = [
      'watchtower_url',
      'watchtower_api_token',
      'watchtower_webhook_secret',
      'watchtower_webhook_id',
      'watchtower_configured_at',
      'watchtower_webhook_registered_at',
      'watchtower_last_sync'
    ];

    await db.setting.deleteMany({
      where: {
        key: {
          in: settingsToRemove
        }
      }
    });

    // Clear WatchTower metadata from users (optional - keep user accounts)
    await db.user.updateMany({
      where: {
        watchTowerUserId: { not: null }
      },
      data: {
        watchTowerUserId: null,
        watchTowerUsername: null,
        watchTowerMetadata: undefined
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Successfully disconnected from WatchTower'
    });

  } catch (error) {
    console.error('Error disconnecting from WatchTower:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect from WatchTower', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 