import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
    const watchTowerUser = watchTowerResponse.user;

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
      watchTowerUserId: watchTowerUser.id?.toString() || '',
      watchTowerUsername: watchTowerUser.username || '',
      role: isAdmin ? 'ADMIN' : 'USER',
      isActive: watchTowerUser.is_active !== false,
      watchTowerMetadata: {
        isAdmin: watchTowerUser.is_admin || false,
        isStaff: watchTowerUser.is_staff || false,
        isSuperuser: watchTowerUser.is_superuser || false,
        dateJoined: watchTowerUser.date_joined || new Date().toISOString(),
        lastLogin: new Date().toISOString()
      }
    };

    if (user) {
      // Update existing user
      
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...userData,
          updatedAt: new Date()
        }
      });
      

      // For existing users, delete and recreate to use better-auth
      
      
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

    

    // Update with WatchTower-specific fields
    const updatedUser = await prisma.user.update({
      where: { id: signUpResult.user.id },
      data: {
        watchTowerUserId: userData.watchTowerUserId,
        watchTowerUsername: userData.watchTowerUsername,
        role: userData.role,
        isActive: userData.isActive,
        watchTowerMetadata: userData.watchTowerMetadata,
        watchTowerJoinDate: userData.watchTowerMetadata?.dateJoined ? new Date(userData.watchTowerMetadata.dateJoined) : new Date(),
        password: null, // Clear password for SSO users
      }
    });


    // Sign in the user to create a proper session
    const signInResponse = await auth.api.signInEmail({
      body: {
        email: userData.email,
        password: tempPassword
      },
      asResponse: true // Receive a full Response object so we get the signed cookies
    }) as Response;

    // Extract JSON payload (user + token) from the Better-Auth response
    const signInResult = await signInResponse.clone().json().catch(() => ({}));

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
      redirectTo: '/dashboard'
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