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

// POST /api/admin/watchtower/register-webhooks
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

    // Get or generate webhook secret
    let webhookSecret = await db.setting.findUnique({
      where: { key: 'watchtower_webhook_secret' }
    });

    if (!webhookSecret) {
      const crypto = require('crypto');
      const secret = crypto.randomBytes(32).toString('hex');
      webhookSecret = await db.setting.create({
        data: { key: 'watchtower_webhook_secret', value: secret }
      });
    }

    // Get the current server URL for webhook endpoint
    const serverUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const webhookUrl = `${serverUrl}/api/webhooks/watchtower`;

    // Register webhook with WatchTower
    const webhookData = {
      app_name: 'twentyfourseven',
      url: webhookUrl,
      events: [
        'user.created',
        'user.updated', 
        'user.deleted',
        'service.updated',
        'donation.received'
      ],
      secret: webhookSecret.value,
      is_active: true
    };

    const response = await fetch(`${watchTowerUrl}/api/v1/webhooks/register/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify(webhookData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { 
          error: 'Failed to register webhook with WatchTower', 
          details: errorText,
          status: response.status
        },
        { status: 400 }
      );
    }

    const webhookResult = await response.json();

    // Save webhook registration details
    await db.setting.upsert({
      where: { key: 'watchtower_webhook_id' },
      update: { value: webhookResult.webhook_id?.toString() || 'registered' },
      create: { key: 'watchtower_webhook_id', value: webhookResult.webhook_id?.toString() || 'registered' }
    });

    await db.setting.upsert({
      where: { key: 'watchtower_webhook_registered_at' },
      update: { value: new Date().toISOString() },
      create: { key: 'watchtower_webhook_registered_at', value: new Date().toISOString() }
    });

    return NextResponse.json({
      success: true,
      message: 'Webhook registered successfully with WatchTower',
      webhookUrl,
      events: webhookData.events,
      webhookId: webhookResult.webhook_id
    });

  } catch (error) {
    console.error('Error registering webhook:', error);
    return NextResponse.json(
      { error: 'Failed to register webhook', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 