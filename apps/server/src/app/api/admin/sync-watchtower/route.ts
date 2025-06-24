import { NextRequest, NextResponse } from 'next/server';
import { WatchTowerHubService } from '@/lib/watchtower-hub-service-simple';

export async function POST(request: NextRequest) {
  try {
    // You should add authentication here to ensure only admins can trigger sync
    // const session = await getSession(request);
    // if (!session?.user?.isAdmin) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    const watchTowerService = WatchTowerHubService.getInstance();
    
    // Check connection first
    const isConnected = await watchTowerService.checkConnection();
    if (!isConnected) {
      return NextResponse.json(
        { error: 'Cannot connect to WatchTower' },
        { status: 503 }
      );
    }

    // Perform sync
    const syncResult = await watchTowerService.syncUsers();

    return NextResponse.json({
      success: true,
      ...syncResult,
      message: `Sync completed: ${syncResult.created} created, ${syncResult.updated} updated, ${syncResult.skipped} skipped`
    });

  } catch (error) {
    console.error('Error syncing with WatchTower:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const watchTowerService = WatchTowerHubService.getInstance();
    const isConnected = await watchTowerService.checkConnection();

    return NextResponse.json({
      connected: isConnected,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json(
      { connected: false, error: 'Connection check failed' },
      { status: 500 }
    );
  }
} 