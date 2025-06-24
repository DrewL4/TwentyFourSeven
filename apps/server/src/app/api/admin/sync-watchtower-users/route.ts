import { NextRequest, NextResponse } from "next/server";
import { WatchTowerHubService } from "@/lib/watchtower-hub-service-simple";

export async function POST(request: NextRequest) {
  try {
    const watchTowerService = WatchTowerHubService.getInstance();
    const results = await watchTowerService.syncUsers();

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