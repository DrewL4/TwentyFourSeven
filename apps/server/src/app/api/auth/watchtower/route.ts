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
    console.log('🔐 WatchTower SSO login attempt started');
    const { email, password } = await request.json();

    if (!email || !password) {
      console.log('❌ Missing email or password');
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    console.log('👤 Login attempt for email:', email);

    const config = await getWatchTowerConfig();

    if (!config.url || !config.apiToken) {
      console.log('❌ WatchTower not configured - URL:', !!config.url, 'Token:', !!config.apiToken);
      return NextResponse.json(
        { error: 'WatchTower not configured. Please contact administrator.' },
        { status: 503 }
      );
    }

    console.log('🌐 Authenticating with WatchTower at:', config.url);

    // Authenticate with WatchTower
    const authResponse = await fetch(`${config.url}/api/api/v1/auth/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    console.log('🔑 WatchTower auth response status:', authResponse.status);

    if (!authResponse.ok) {
      const error = await authResponse.text();
      console.log('❌ WatchTower authentication failed:', error);
      return NextResponse.json(
        { error: 'Invalid WatchTower credentials', details: error },
        { status: 401 }
      );
    }

    const authData = await authResponse.json();
    console.log('✅ WatchTower authentication successful, got token');

    // Get user details from WatchTower
    const userResponse = await fetch(`${config.url}/api/api/v1/users/me/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${authData.access_token}`
      }
    });

    console.log('👤 WatchTower user details response status:', userResponse.status);

    if (!userResponse.ok) {
      console.log('❌ Failed to get user details from WatchTower');
      return NextResponse.json(
        { error: 'Failed to get user details from WatchTower' },
        { status: 500 }
      );
    }

    const watchTowerResponse = await userResponse.json();
    const watchTowerUser = watchTowerResponse.user;
    
    console.log('📋 Got WatchTower user:', watchTowerUser?.email, 'ID:', watchTowerUser?.id);

    // Check if user exists
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: watchTowerUser.email },
          { watchTowerUserId: watchTowerUser.id?.toString() }
        ]
      }
    });

    console.log('🔍 Existing user found:', !!user);

    const userData = {
      name: watchTowerUser.first_name && watchTowerUser.last_name 
        ? `${watchTowerUser.first_name} ${watchTowerUser.last_name}`.trim()
        : watchTowerUser.username || watchTowerUser.email || 'WatchTower User',
      email: watchTowerUser.email || '',
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
      console.log('📝 Updating existing user:', user.id);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...userData,
          updatedAt: new Date()
        }
      });
      console.log('✅ Existing user updated successfully');

      // For existing users, delete and recreate to use better-auth
      console.log('♻️ Recreating user with better-auth...');
      
      // Delete existing user and sessions
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }

    // Create temporary password for the user
    const tempPassword = crypto.randomBytes(16).toString('hex');

    // Create new user using better-auth's signUpEmail
    console.log('➕ Creating user with better-auth signUpEmail...');
    
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

    console.log('✅ User created with better-auth');

    // Update with WatchTower-specific fields
    await prisma.user.update({
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

    console.log('✅ User WatchTower metadata updated');

    // Sign in the user to create a proper session
    console.log('🔐 Signing in user to create session...');
    
    const signInResponse = await auth.api.signInEmail({
      body: {
        email: userData.email,
        password: tempPassword
      },
      asResponse: true // Receive a full Response object so we get the signed cookies
    }) as Response;

    // Extract JSON payload (user + token) from the Better-Auth response
    const signInResult = await signInResponse.clone().json().catch(() => ({}));

    console.log('🪵 signInResult', signInResult);

    console.log('✅ User signed in and session created');

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

    console.log('🎉 WatchTower SSO login completed successfully');
    return response;

  } catch (error) {
    console.error('💥 WatchTower SSO error:', error);
    return NextResponse.json(
      { error: 'SSO login failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 