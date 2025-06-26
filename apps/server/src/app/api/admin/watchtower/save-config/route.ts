import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/context';
import crypto from 'crypto';

// Helper function to check admin permissions or allow initial setup
async function checkAdminAuthOrInitialSetup(request: NextRequest) {
  try {
    // Check if this is initial setup (no users exist)
    const userCount = await db.user.count();
    console.log('👥 User count in database:', userCount);
    
    if (userCount === 0) {
      console.log('✅ Allowing initial setup - no users exist');
      return null; // Allow initial setup
    }

    // Check if WatchTower is already configured
    const existingConfig = await db.setting.findFirst({
      where: { key: 'watchtower_configured_at' }
    });
    
    console.log('⚙️ Existing WatchTower config:', !!existingConfig);
    
    if (!existingConfig) {
      console.log('✅ Allowing initial WatchTower configuration');
      return null; // Allow initial configuration
    }

    // For existing configurations, require admin auth
    console.log('🔒 Checking admin authentication for existing configuration...');
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    
    console.log('🍪 Session found:', !!session?.user?.id);
    
    if (!session?.user?.id) {
      console.log('❌ No valid session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.user.findUnique({
      where: { id: session.user.id }
    });

    console.log('👤 User role:', user?.role);

    if (user?.role !== 'ADMIN') {
      console.log('❌ User is not admin');
      return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    }

    console.log('✅ Admin authentication successful');
    return null;
    
  } catch (error) {
    console.error('💥 Error in auth check:', error);
    // If there's a database error, it might be initial setup
    return null; // Allow setup to continue
  }
}

// POST /api/admin/watchtower/save-config
export async function POST(request: NextRequest) {
  console.log('💾 WatchTower save-config endpoint called');
  
  const authError = await checkAdminAuthOrInitialSetup(request);
  if (authError) return authError;

  try {
    const { watchTowerUrl, apiToken } = await request.json();
    console.log('📝 Saving WatchTower config - URL:', watchTowerUrl, 'Token:', !!apiToken);

    if (!watchTowerUrl || !apiToken) {
      console.log('❌ Missing required fields');
      return NextResponse.json(
        { error: 'WatchTower URL and API token are required' },
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

    console.log('✅ WatchTower configuration saved successfully');
    return NextResponse.json({
      success: true,
      message: 'WatchTower configuration saved successfully',
      webhookSecret
    });

  } catch (error) {
    console.error('💥 Error saving WatchTower config:', error);
    return NextResponse.json(
      { error: 'Failed to save configuration' },
      { status: 500 }
    );
  }
} 