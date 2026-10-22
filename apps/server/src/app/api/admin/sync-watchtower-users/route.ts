import { guardAdminRoute } from '@/lib/admin-route-guard';
import { NextRequest, NextResponse } from "next/server";
import { WatchTowerHubService } from "@/lib/watchtower-hub-service";

export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute(request);
  if (denied) return denied;

  try {
    const watchTowerService = WatchTowerHubService.getInstance();
    await watchTowerService.initialize(); // Ensure service is initialized
    const results = await watchTowerService.syncUsers();

    console.log(`[Sync] Sync completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`);

    return NextResponse.json({
      success: true,
      results
    });
  } catch (error) {
    console.error("Error syncing WatchTower users:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync WatchTower users" },
      { status: 500 }
    );
  }
} 