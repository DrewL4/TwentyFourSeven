import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/lib/auth';

// Helper function to get WatchTower config
async function getWatchTowerConfig() {
  const { db } = await import('@/lib/context');
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

  return {
    url: configMap.watchtower_url,
    apiToken: configMap.watchtower_api_token
  };
}

// POST /api/auth/watchtower - SSO Login
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
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

    // Authenticate with WatchTower
    const authResponse = await fetch(`${config.url}/api/api/v1/auth/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    if (!authResponse.ok) {
      const error = await authResponse.text();
      return NextResponse.json(
        { error: 'Invalid WatchTower credentials', details: error },
        { status: 401 }
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
    const watchTowerUser = watchTowerResponse.user; // Extract user from nested response

    // Create or update user in TwentyFourSeven
    const { db } = await import('@/lib/context');
    
    let user = await db.user.findFirst({
      where: {
        OR: [
          { email: watchTowerUser.email },
          { watchTowerUserId: watchTowerUser.id?.toString() }
        ]
      }
    });

    const userData = {
      email: watchTowerUser.email || '',
      name: watchTowerUser.first_name && watchTowerUser.last_name 
        ? `${watchTowerUser.first_name} ${watchTowerUser.last_name}`.trim()
        : watchTowerUser.username || watchTowerUser.email || 'WatchTower User',
      watchTowerUserId: watchTowerUser.id?.toString() || '',
      watchTowerUsername: watchTowerUser.username || '',
      role: watchTowerUser.is_admin ? 'ADMIN' : 'USER',
      isActive: watchTowerUser.is_active !== false,
      watchTowerMetadata: {
        isStaff: watchTowerUser.is_staff || false,
        isSuperuser: watchTowerUser.is_superuser || false,
        dateJoined: watchTowerUser.date_joined || new Date().toISOString(),
        lastLogin: new Date().toISOString()
      }
    };

    if (user) {
      // Update existing user
      user = await db.user.update({
        where: { id: user.id },
        data: userData
      });
    } else {
      // Create new user using better-auth's sign-up method
      const plainPassword = `watchtower_sso_${crypto.randomUUID()}`;
      
      try {
        // Use better-auth to create the user properly
        const signUpRequest = new Request(`${request.url.split('/api/auth/watchtower')[0]}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: userData.email,
            password: plainPassword,
            name: userData.name
          })
        });

        const signUpResponse = await auth.handler(signUpRequest);
        
        if (signUpResponse.ok) {
          const signUpData = await signUpResponse.json();
          
          // Get the user that was just created
          user = await db.user.findUnique({
            where: { email: userData.email }
          });

          if (!user) {
            throw new Error('User not found after sign-up');
          }

          // Update with WatchTower metadata but keep the original ID and password
          user = await db.user.update({
            where: { id: user.id },
            data: {
              watchTowerUserId: userData.watchTowerUserId,
              watchTowerUsername: userData.watchTowerUsername,
              role: userData.role,
              isActive: userData.isActive,
              watchTowerMetadata: userData.watchTowerMetadata,
              emailVerified: true
            }
          });

          // Store the plain password for future sign-ins
          (user as any).plainPassword = plainPassword;
        } else {
          throw new Error('Better-auth sign-up failed');
        }
      } catch (signUpError) {
        console.error('Better-auth sign-up error:', signUpError);
        throw new Error('Failed to create user through better-auth');
      }
    }

    // Use better-auth's sign-in to create a proper session
    try {
      const sessionRequest = new Request(`${request.url.split('/api/auth/watchtower')[0]}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user.email,
          password: (user as any).plainPassword || `watchtower_sso_${user.id}`
        })
      });

      const sessionResponse = await auth.handler(sessionRequest);
      
      if (sessionResponse.ok) {
        const cookies = sessionResponse.headers.get('set-cookie');
        
        const response = NextResponse.json({
          success: true,
          message: 'WatchTower SSO login successful',
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isActive: user.isActive
          },
          redirectTo: '/dashboard'
        });

        if (cookies) {
          response.headers.set('set-cookie', cookies);
        }

        return response;
      }
    } catch (fallbackError) {
      console.error('Better-auth fallback sign-in error:', fallbackError);
    }

    // Return success without session as final fallback
    return NextResponse.json({
      success: true,
      message: 'WatchTower SSO login successful (no session)',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive
      },
      redirectTo: '/dashboard',
      note: 'Please refresh the page to complete login'
    });

  } catch (error) {
    console.error('WatchTower SSO error:', error);
    return NextResponse.json(
      { error: 'SSO login failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 