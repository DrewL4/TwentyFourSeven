import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/context';
import crypto from 'crypto';

// Helper function to check admin permissions or allow initial setup
async function checkAdminAuthOrInitialSetup(request: NextRequest) {
  try {
    // Check if this is initial setup (no users exist)
    const userCount = await db.user.count();
    
    if (userCount === 0) {
      return null; // Allow initial setup
    }

    // Check if WatchTower is already configured
    const existingConfig = await db.setting.findFirst({
      where: { key: 'watchtower_configured_at' }
    });
    
    
    if (!existingConfig) {
      return null; // Allow initial configuration
    }

    // For existing configurations, require admin auth
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
    console.error('💥 Error in auth check:', error);
    // If there's a database error, it might be initial setup
    return null; // Allow setup to continue
  }
}

// POST /api/admin/watchtower/save-config
export async function POST(request: NextRequest) {
  
  const authError = await checkAdminAuthOrInitialSetup(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { watchTowerUrl, apiToken } = body;

    console.log('[Save Config] Received request:', {
      hasWatchTowerUrl: !!watchTowerUrl,
      watchTowerUrlLength: watchTowerUrl?.length || 0,
      hasApiToken: !!apiToken,
      apiTokenLength: apiToken?.length || 0
    });

    if (!watchTowerUrl || !watchTowerUrl.trim()) {
      return NextResponse.json(
        { error: 'WatchTower URL is required', details: 'Please provide a valid WatchTower server URL' },
        { status: 400 }
      );
    }

    if (!apiToken || !apiToken.trim()) {
      return NextResponse.json(
        { error: 'API token is required', details: 'Please provide a valid WatchTower API token' },
        { status: 400 }
      );
    }

    // Generate webhook secret for securing webhook calls
    const webhookSecret = crypto.randomBytes(32).toString('hex');

    // Save configuration
    const settings = [
      { key: 'watchtower_url', value: watchTowerUrl.trim() },
      { key: 'watchtower_api_token', value: apiToken.trim() },
      { key: 'watchtower_webhook_secret', value: webhookSecret },
      { key: 'watchtower_configured_at', value: new Date().toISOString() }
    ];

    for (const setting of settings) {
      await db.setting.upsert({
        where: { key: setting.key },
        update: { value: setting.value },
        create: setting
      });
    }

    return NextResponse.json({
      success: true,
      message: 'WatchTower configuration saved successfully',
      webhookSecret
    });

  } catch (error) {
    console.error('💥 Error saving WatchTower config:', error);
    return NextResponse.json(
      { 
        error: 'Failed to save configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 