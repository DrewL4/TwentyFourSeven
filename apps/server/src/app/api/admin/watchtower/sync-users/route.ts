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

// POST /api/admin/watchtower/sync-users
export async function POST(request: NextRequest) {
  const authError = await checkAdminAuth(request);
  if (authError) return authError;

  try {
    const { watchTowerUrl, apiToken } = await request.json();

    if (!watchTowerUrl || !apiToken) {
      return NextResponse.json(
        { error: 'WatchTower URL and API token are required' },
        { status: 400 }
      );
    }

    // Fetch users from WatchTower
    const response = await fetch(`${watchTowerUrl}/api/v1/users/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: 'Failed to fetch users from WatchTower', details: errorText },
        { status: 400 }
      );
    }

    const usersData = await response.json();
    const users = usersData.results || usersData;

    if (!Array.isArray(users)) {
      return NextResponse.json(
        { error: 'Invalid user data format from WatchTower' },
        { status: 400 }
      );
    }

    let syncStats = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0
    };

    // Sync each user
    for (const watchTowerUser of users) {
      try {
        if (!watchTowerUser.email) {
          syncStats.skipped++;
          continue;
        }

        // Check if user already exists
        const existingUser = await db.user.findFirst({
          where: {
            OR: [
              { email: watchTowerUser.email },
              { watchTowerUserId: watchTowerUser.id?.toString() }
            ]
          }
        });

        const userData = {
          email: watchTowerUser.email,
          name: watchTowerUser.first_name && watchTowerUser.last_name 
            ? `${watchTowerUser.first_name} ${watchTowerUser.last_name}`.trim()
            : watchTowerUser.username || watchTowerUser.email,
          watchTowerUserId: watchTowerUser.id?.toString(),
          watchTowerUsername: watchTowerUser.username,
          role: watchTowerUser.is_admin ? 'ADMIN' : 'USER',
          isActive: watchTowerUser.is_active !== false,
          // Store additional WatchTower metadata
          watchTowerMetadata: {
            isStaff: watchTowerUser.is_staff,
            isSuperuser: watchTowerUser.is_superuser,
            dateJoined: watchTowerUser.date_joined,
            lastLogin: watchTowerUser.last_login,
            profile: watchTowerUser.profile || {}
          }
        };

        if (existingUser) {
          // Update existing user
          await db.user.update({
            where: { id: existingUser.id },
            data: userData
          });
          syncStats.updated++;
        } else {
          // Create new user
          await db.user.create({
            data: {
              ...userData,
              // Required fields for user creation
              id: `watchtower_${watchTowerUser.id}_${Date.now()}`,
              emailVerified: false,
              createdAt: new Date(),
              updatedAt: new Date(),
              // Set a temporary password - they'll use SSO
              password: `watchtower_sso_${Date.now()}`
            }
          });
          syncStats.created++;
        }

      } catch (userError) {
        console.error(`Error syncing user ${watchTowerUser.email}:`, userError);
        syncStats.errors++;
      }
    }

    // Update last sync timestamp
    await db.setting.upsert({
      where: { key: 'watchtower_last_sync' },
      update: { value: new Date().toISOString() },
      create: { key: 'watchtower_last_sync', value: new Date().toISOString() }
    });

    return NextResponse.json({
      success: true,
      message: 'User sync completed successfully',
      stats: syncStats,
      totalUsers: users.length
    });

  } catch (error) {
    console.error('Error syncing users:', error);
    return NextResponse.json(
      { error: 'Failed to sync users', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 