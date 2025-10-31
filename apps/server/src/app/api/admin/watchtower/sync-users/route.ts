import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/context';

// Helper function to check admin permissions or allow initial setup
async function checkAdminAuthOrInitialSetup(request: NextRequest) {
  try {
    // Check if this is initial setup (no users exist)
    const userCount = await db.user.count();
    
    if (userCount === 0) {
      return null; // Allow initial setup
    }

    // For existing users, require admin auth
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
  } catch (error) {
    console.error('Error in auth check:', error);
    // If there's a database error, it might be initial setup
    return null; // Allow setup to continue
  }
}

// POST /api/admin/watchtower/sync-users
export async function POST(request: NextRequest) {
  const authError = await checkAdminAuthOrInitialSetup(request);
  if (authError) return authError;

  try {
    // Try to get from request body first, fallback to saved config
    const body = await request.json().catch(() => ({}));
    let watchTowerUrl = body.watchTowerUrl;
    let apiToken = body.apiToken;

    // If not provided in request, get from saved settings
    if (!watchTowerUrl || !apiToken) {
      const config = await db.setting.findMany({
        where: {
          key: {
            in: ['watchtower_url', 'watchtower_api_token']
          }
        }
      });

      const configMap = config.reduce((acc: Record<string, string>, setting: any) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});

      watchTowerUrl = watchTowerUrl || configMap.watchtower_url;
      apiToken = apiToken || configMap.watchtower_api_token;
    }

    if (!watchTowerUrl || !apiToken) {
      return NextResponse.json(
        { error: 'WatchTower URL and API token are required. Please configure WatchTower first or provide them in the request.' },
        { status: 400 }
      );
    }

    // Fetch users from WatchTower
    const response = await fetch(`${watchTowerUrl}/api/api/v1/users/`, {
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
    const allUsers = usersData.results || usersData;

    if (!Array.isArray(allUsers)) {
      return NextResponse.json(
        { error: 'Invalid user data format from WatchTower' },
        { status: 400 }
      );
    }

    // Filter to only users with movie services (including expired - we'll mark them)
    const movieServiceUsers = allUsers.filter((user: any) => {
      // Admins always count as movie users
      if (user.is_admin) {
        return true;
      }
      // Family users always count as movie users
      if (user.is_family) {
        return true;
      }
      // Must be active and have movie service indicator
      return user.is_active && (user.movie_service || user.is_movie_user);
    });

    let syncStats = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      filtered: allUsers.length - movieServiceUsers.length
    };

    // Helper function to check if movie donation is expired
    const isMovieDonationExpired = (user: any): boolean => {
      if (user.is_admin || user.is_family) {
        return false;
      }
      if (!user.movie_donation_due) {
        return true;
      }
      try {
        const dueDate = new Date(user.movie_donation_due);
        const now = new Date();
        return dueDate < now;
      } catch {
        return true;
      }
    };

    // Helper function to check if user should have movie service access
    // Based on WatchTower logic: admins and family users always have access
    // Other users must have a valid movie_donation_due date
    const shouldHaveMovieServiceAccess = (user: any): boolean => {
      // Admins always have access
      if (user.is_admin) {
        return true;
      }

      // Family users always have access (even without donation due date)
      if (user.is_family) {
        return true;
      }

      // Must be active
      if (!user.is_active) {
        return false;
      }

      // Must have movie service indicator
      if (!user.movie_service && !user.is_movie_user) {
        return false;
      }

      // Must have a movie donation due date (required for non-admin, non-family users)
      if (!user.movie_donation_due) {
        return false;
      }

      // Check if donation due date is valid (not expired)
      try {
        const dueDate = new Date(user.movie_donation_due);
        const now = new Date();
        if (dueDate < now) {
          return false;
        }
      } catch (error) {
        // If we can't parse the date, deny access to be safe
        return false;
      }

      return true;
    };

    // Sync each movie service user
    for (const watchTowerUser of movieServiceUsers) {
      try {
        if (!watchTowerUser.email) {
          syncStats.skipped++;
          continue;
        }

        // Check if donation is expired (we import all movie users regardless)
        const isExpired = isMovieDonationExpired(watchTowerUser);
        const hasAccess = shouldHaveMovieServiceAccess(watchTowerUser);

        // Check if user already exists
        const existingUser = await db.user.findFirst({
          where: {
            OR: [
              { email: watchTowerUser.email },
              { watchTowerUserId: watchTowerUser.id?.toString() }
            ]
          }
        });

        // Determine admin status - check multiple fields for compatibility
        // WatchTower may return is_admin, or is_staff/is_superuser
        const isAdmin = watchTowerUser.is_admin === true || 
                        (watchTowerUser.is_staff === true && watchTowerUser.is_superuser === true);

        const userData = {
          email: watchTowerUser.email,
          name: watchTowerUser.first_name && watchTowerUser.last_name 
            ? `${watchTowerUser.first_name} ${watchTowerUser.last_name}`.trim()
            : watchTowerUser.username || watchTowerUser.email,
          watchTowerUserId: watchTowerUser.id?.toString(),
          watchTowerUsername: watchTowerUser.username,
          role: isAdmin ? 'ADMIN' : 'USER',
          isActive: hasAccess, // Set to false if expired (will block login)
          watchTowerJoinDate: watchTowerUser.date_joined ? new Date(watchTowerUser.date_joined) : null,
          // Store additional WatchTower metadata including movie service info
          watchTowerMetadata: {
            isAdmin: watchTowerUser.is_admin || false,
            isStaff: watchTowerUser.is_staff,
            isSuperuser: watchTowerUser.is_superuser,
            isFamily: watchTowerUser.is_family || false,
            dateJoined: watchTowerUser.date_joined,
            lastLogin: watchTowerUser.last_login,
            profile: watchTowerUser.profile || {},
            movie_service: watchTowerUser.movie_service || null,
            movie_service_id: watchTowerUser.movie_service_id || null,
            is_movie_user: watchTowerUser.is_movie_user || false,
            movie_donation_due: watchTowerUser.movie_donation_due || null,
            movie_donation_amount: watchTowerUser.movie_donation_amount || null,
            movie_donation_expired: isExpired
          }
        };

        if (existingUser) {
          // Update existing user
          await db.user.update({
            where: { id: existingUser.id },
            data: {
              ...userData,
              updatedAt: new Date()
            }
          });
          syncStats.updated++;
          console.log(`Updated movie service user: ${watchTowerUser.email}${isExpired ? ' (EXPIRED)' : ''}`);
        } else {
          // Create new user with proper ID generation
          const userId = `watchtower_${watchTowerUser.id}_${Date.now()}`;
          await db.user.create({
            data: {
              ...userData,
              // Required fields for user creation
              id: userId,
              emailVerified: false,
              createdAt: userData.watchTowerJoinDate || new Date(),
              updatedAt: new Date(),
              // No password set - they'll use SSO or forgot password
              password: null
            }
          });
          syncStats.created++;
          console.log(`Created movie service user: ${watchTowerUser.email}${isExpired ? ' (EXPIRED)' : ''}`);
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
      message: 'Movie service user sync completed successfully',
      stats: syncStats,
      totalUsers: allUsers.length,
      movieServiceUsers: movieServiceUsers.length,
      syncedUsers: syncStats.created + syncStats.updated
    });

  } catch (error) {
    console.error('Error syncing users:', error);
    return NextResponse.json(
      { error: 'Failed to sync users', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 