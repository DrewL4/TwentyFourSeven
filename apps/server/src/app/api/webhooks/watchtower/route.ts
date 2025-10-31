import { NextRequest, NextResponse } from 'next/server';
import { WatchTowerHubService } from '@/lib/watchtower-hub-service';

export async function POST(request: NextRequest) {
  try {
    console.log('[Webhook] Received POST request');
    
    // Get the webhook payload
    const body = await request.text();
    const signature = request.headers.get('X-Webhook-Signature');

    console.log('[Webhook] Headers:', {
      hasSignature: !!signature,
      contentType: request.headers.get('content-type'),
      userAgent: request.headers.get('user-agent')
    });

    if (!signature) {
      console.error('[Webhook] Missing webhook signature');
      console.log('[Webhook] Request body preview:', body.substring(0, 200));
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 401 }
      );
    }

    // Verify webhook signature
    const watchTowerService = WatchTowerHubService.getInstance();
    await watchTowerService.initialize(); // Ensure service is initialized
    const isValidSignature = watchTowerService.verifyWebhookSignature(body, signature);

    if (!isValidSignature) {
      console.error('[Webhook] Invalid webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse the webhook event
    const webhookEvent = JSON.parse(body);
    
    console.log(`[Webhook] Received webhook from WatchTower: ${webhookEvent.event_type}`);
    
    // Log event details for movie service filtering
    if (webhookEvent.event_type === 'user.created' || webhookEvent.event_type === 'user.updated') {
      const userData = webhookEvent.data;
      const hasMovieService = !!(userData.movie_service || userData.is_movie_user);
      console.log(`[Webhook] User ${userData.email} - has movie service: ${hasMovieService}, movie_donation_due: ${userData.movie_donation_due || 'none'}`);
    }

    // Process the webhook event
    await watchTowerService.handleWebhookEvent(webhookEvent);

    console.log(`[Webhook] Successfully processed ${webhookEvent.event_type} event`);
    return NextResponse.json({ 
      status: 'processed',
      event_type: webhookEvent.event_type,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Webhook] Error processing WatchTower webhook:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Health check endpoint for the webhook
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'twentyfourseven-webhook',
    timestamp: new Date().toISOString()
  });
} 