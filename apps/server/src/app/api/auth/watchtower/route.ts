import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  classifyWatchTowerLoginFailure,
  describeFetchError,
  watchTowerUnreachableMessage,
} from '@/lib/watchtower-reach';

// Helper function to get WatchTower config
async function getWatchTowerConfig() {
  const config = await prisma.setting.findMany({
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

  return {
    url: configMap.watchtower_url,
    apiToken: configMap.watchtower_api_token
  };
}

// POST /api/auth/watchtower - SSO Login
export async function POST(request: NextRequest) {
  try {
    
    const body = await request.json();
    // WatchTower's login API matches this value against username, then email.
    const login = String(body.login ?? body.email ?? '').trim();
    const password = body.password;

    if (!login || !password) {
      return NextResponse.json(
        { error: 'Enter your WatchTower email or username and your password.' },
        { status: 400 }
      );
    }

    

    const config = await getWatchTowerConfig();

    if (!config.url || !config.apiToken) {
      
      return NextResponse.json(
        { error: 'WatchTower not configured. Please contact administrator.' },
        { status: 503 }
      );
    }

    

    // Authenticate with WatchTower. redirect: 'manual' so an address that is not
    // WatchTower (e.g. http://localhost = this container's own nginx) is reported
    // as a connection problem instead of "Invalid WatchTower credentials".
    let authResponse: Response;
    try {
      authResponse = await fetch(`${config.url}/api/api/v1/auth/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: login, password }),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
    } catch (fetchError) {
      return NextResponse.json(
        { error: watchTowerUnreachableMessage(config.url, describeFetchError(fetchError)) },
        { status: 502 }
      );
    }

    if (!authResponse.ok) {
      const failure = classifyWatchTowerLoginFailure(
        config.url,
        authResponse.status,
        authResponse.headers.get('content-type'),
        await authResponse.text(),
      );
      return NextResponse.json(
        { error: failure.kind === 'ok' ? 'Sign in failed.' : failure.message },
        { status: failure.kind === 'bad_credentials' ? 401 : 502 }
      );
    }

    const authData = await authResponse.json();
    

    // Get user details from WatchTower
    const userResponse = await fetch(`${config.url}/api/api/v1/users/me/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${authData.access_token}`
      }
    });

    

    if (!userResponse.ok) {
      
      return NextResponse.json(
        { error: 'Failed to get user details from WatchTower' },
        { status: 500 }
      );
    }

    const watchTowerResponse = await userResponse.json();
    let watchTowerUser = watchTowerResponse.user;

    // Authoritative pull: canonical user detail on every login
    const wtUserId = watchTowerUser?.id || watchTowerUser?.user_id;
    if (wtUserId && config.apiToken) {
      const canonicalResponse = await fetch(
        `${config.url}/api/api/v1/users/${wtUserId}/`,
        {
          method: 'GET',
          headers: {
            Authorization: `Token ${config.apiToken}`,
          },
        },
      );
      if (canonicalResponse.ok) {
        const canonicalBody = await canonicalResponse.json();
        watchTowerUser = canonicalBody.user || canonicalBody;
      }
    }

    // Check if user has movie service access
    // Based on WatchTower logic: admins and family users always have access
    // Other users must have a valid movie_donation_due date
    const hasMovieServiceAccess = (() => {
      // Admins always have access
      if (watchTowerUser.is_admin) {
        return true;
      }

      // Family users always have access (even without donation due date)
      if (watchTowerUser.is_family) {
        return true;
      }

      // Must be active
      if (!watchTowerUser.is_active) {
        return false;
      }

      // Must have movie service indicator
      if (!watchTowerUser.movie_service && !watchTowerUser.is_movie_user) {
        return false;
      }

      // Must have a movie donation due date (required for non-admin, non-family users)
      if (!watchTowerUser.movie_donation_due) {
        return false;
      }

      // Check if donation due date is valid (not expired)
      try {
        const dueDate = new Date(watchTowerUser.movie_donation_due);
        const now = new Date();
        if (dueDate < now) {
          return false;
        }
      } catch (error) {
        // If we can't parse the date, deny access to be safe
        return false;
      }

      return true;
    })();

    // Check if donation is expired (for error message)
    const isExpired = (() => {
      if (watchTowerUser.is_admin || watchTowerUser.is_family) {
        return false;
      }
      if (!watchTowerUser.movie_donation_due) {
        return true;
      }
      try {
        const dueDate = new Date(watchTowerUser.movie_donation_due);
        const now = new Date();
        return dueDate < now;
      } catch {
        return true;
      }
    })();

    if (!hasMovieServiceAccess) {
      // Provide specific error message for expired users
      if (isExpired && watchTowerUser.movie_donation_due) {
        const expirationDate = new Date(watchTowerUser.movie_donation_due).toLocaleDateString();
        return NextResponse.json(
          { 
            error: 'Your movie service subscription has expired.',
            expirationDate: watchTowerUser.movie_donation_due,
            expirationDateFormatted: expirationDate
          },
          { status: 403 }
        );
      }
      
      return NextResponse.json(
        { error: 'You do not have access to this service. A movie service subscription is required.' },
        { status: 403 }
      );
    }

    // Check if user exists
    let user = await prisma.user.findFirst({
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
      name: watchTowerUser.first_name && watchTowerUser.last_name 
        ? `${watchTowerUser.first_name} ${watchTowerUser.last_name}`.trim()
        : watchTowerUser.username || watchTowerUser.email || 'WatchTower User',
      email: watchTowerUser.email || '',
      // Kept apart for the playlist login rule (playlist name + first name / last name).
      firstName: String(watchTowerUser.first_name || '').trim() || null,
      lastName: String(watchTowerUser.last_name || '').trim() || null,
      watchTowerUserId: watchTowerUser.id?.toString() || '',
      watchTowerUsername: watchTowerUser.username || '',
      role: isAdmin ? 'ADMIN' : 'USER',
      isActive: true, // Only allow active users with movie service access
      watchTowerMetadata: {
        isAdmin: watchTowerUser.is_admin || false,
        isStaff: watchTowerUser.is_staff || false,
        isSuperuser: watchTowerUser.is_superuser || false,
        isFamily: watchTowerUser.is_family || false,
        dateJoined: watchTowerUser.date_joined || new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        movie_service: watchTowerUser.movie_service || null,
        movie_service_id: watchTowerUser.movie_service_id || null,
        is_movie_user: watchTowerUser.is_movie_user || false,
        movie_donation_due: watchTowerUser.movie_donation_due || null,
        movie_donation_amount: watchTowerUser.movie_donation_amount || null
      }
    };

    let keptPlaylistLoginId: string | null = null;
    let oldUserId: string | null = null;
    if (user) {
      oldUserId = user.id;
      // Update existing user
      
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...userData,
          updatedAt: new Date()
        }
      });
      

      // For existing users, delete and recreate to use better-auth
      
      
      // The playlist login is keyed by user id; keep it so TV apps keep working
      // after the user is recreated below.
      keptPlaylistLoginId =
        (await prisma.playlistLogin.findUnique({ where: { userId: user.id }, select: { id: true } }))?.id ?? null;

      // Delete existing user and sessions
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }

    // Create temporary password for the user
    const tempPassword = crypto.randomBytes(16).toString('hex');

    // Create new user using better-auth's signUpEmail
    
    
    const signUpResult = await auth.api.signUpEmail({
      body: {
        name: userData.name,
        email: userData.email,
        password: tempPassword,
        callbackURL: undefined
      }
    });

    if (!signUpResult) {
      throw new Error('Failed to create user with better-auth');
    }

    

    // Sign in before clearing credentials so Better Auth can issue session cookies
    const signInResponse = await auth.api.signInEmail({
      body: {
        email: userData.email,
        password: tempPassword,
      },
      asResponse: true,
    }) as Response;

    if (!signInResponse.ok) {
      const signInError = await signInResponse.clone().text().catch(() => "");
      throw new Error(
        signInError || "Failed to create session after WatchTower sign-in",
      );
    }

    // Attach WatchTower fields after session is established
    await prisma.user.update({
      where: { id: signUpResult.user.id },
      data: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        watchTowerUserId: userData.watchTowerUserId,
        watchTowerUsername: userData.watchTowerUsername,
        role: userData.role,
        isActive: userData.isActive,
        watchTowerMetadata: userData.watchTowerMetadata,
        watchTowerJoinDate: userData.watchTowerMetadata?.dateJoined
          ? new Date(userData.watchTowerMetadata.dateJoined)
          : new Date(),
        password: null,
      },
    });

    if (keptPlaylistLoginId) {
      await prisma.playlistLogin
        .update({ where: { id: keptPlaylistLoginId }, data: { userId: signUpResult.user.id } })
        .catch((e: unknown) => console.warn("[watchtower] could not keep playlist login:", e instanceof Error ? e.message : "error"));
    }
    // Other rows that point at the user by id (no foreign key, so nothing
    // cascades): device keys this user made and IP-to-person mappings.
    if (oldUserId && oldUserId !== signUpResult.user.id) {
      const newUserId = signUpResult.user.id;
      await Promise.all([
        prisma.playerKey.updateMany({ where: { userId: oldUserId }, data: { userId: newUserId } }),
        prisma.viewer.updateMany({ where: { userId: oldUserId }, data: { userId: newUserId } }),
      ]).catch((e: unknown) => console.warn("[watchtower] could not move user rows:", e instanceof Error ? e.message : "error"));
    }

    // Create response
    const response = NextResponse.json({
      success: true,
      message: 'WatchTower SSO login successful',
      user: {
        id: signUpResult.user.id,
        email: signUpResult.user.email,
        name: signUpResult.user.name,
        role: userData.role,
        isActive: userData.isActive
      },
      redirectTo: '/'
    });

    // Copy any Set-Cookie headers Better-Auth produced (these are already signed)
    signInResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        response.headers.append('set-cookie', value);
      }
    });

    
    return response;

  } catch (error) {
    
    return NextResponse.json(
      { error: 'SSO login failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 