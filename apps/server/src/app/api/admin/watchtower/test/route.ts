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

// POST /api/admin/watchtower/test
export async function POST(request: NextRequest) {
  const authError = await checkAdminAuth(request);
  if (authError) return authError;

  try {
    const { watchTowerUrl, apiToken } = await request.json();

    if (!watchTowerUrl || !apiToken) {
      return NextResponse.json(
        { success: false, error: 'WatchTower URL and API token are required' },
        { status: 400 }
      );
    }

    // Test API token validation
    const tokenResponse = await fetch(`${watchTowerUrl}/api/v1/auth/validate-token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      }
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      return NextResponse.json({
        success: false,
        error: `Token validation failed: ${tokenError}`,
        details: {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText
        }
      });
    }

    const tokenData = await tokenResponse.json();

    // Test users API access
    const usersResponse = await fetch(`${watchTowerUrl}/api/v1/users/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`
      }
    });

    if (!usersResponse.ok) {
      return NextResponse.json({
        success: false,
        error: 'Users API access failed - check token permissions',
        details: {
          tokenValid: true,
          usersAccess: false
        }
      });
    }

    const usersData = await usersResponse.json();

    // Test services API access
    const servicesResponse = await fetch(`${watchTowerUrl}/api/v1/services/`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`
      }
    });

    const servicesAccess = servicesResponse.ok;

    return NextResponse.json({
      success: true,
      message: 'Connection successful!',
      details: {
        tokenValid: true,
        usersAccess: true,
        servicesAccess,
        userCount: usersData.results?.length || usersData.length || 0,
        permissions: tokenData.permissions || [],
        watchTowerVersion: usersResponse.headers.get('X-WatchTower-Version') || 'Unknown'
      }
    });

  } catch (error) {
    console.error('WatchTower connection test failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Connection test failed',
      details: {
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'network_error'
      }
    }, { status: 500 });
  }
} 