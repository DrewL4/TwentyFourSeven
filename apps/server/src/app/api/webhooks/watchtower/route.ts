import { NextRequest, NextResponse } from 'next/server';
import { WatchTowerHubService } from '@/lib/watchtower-hub-service-simple';

export async function POST(request: NextRequest) {
  try {
    // Get the webhook payload
    const body = await request.text();
    const signature = request.headers.get('X-Webhook-Signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 401 }
      );
    }

    // Verify webhook signature
    const watchTowerService = WatchTowerHubService.getInstance();
    const isValidSignature = watchTowerService.verifyWebhookSignature(body, signature);

    if (!isValidSignature) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse the webhook event
    const webhookEvent = JSON.parse(body);
    
    console.log(`Received webhook from WatchTower: ${webhookEvent.event_type}`);

    // Process the webhook event
    await watchTowerService.handleWebhookEvent(webhookEvent);

    return NextResponse.json({ status: 'processed' });

  } catch (error) {
    console.error('Error processing WatchTower webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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