import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" }
    });

    if (!settings) {
      return NextResponse.json({
        success: true,
        settings: {
          watchTowerEnabled: false,
          watchTowerUrl: "",
          watchTowerUsername: "",
          watchTowerAutoSync: false,
          watchTowerSyncInterval: 24,
          watchTowerLastSync: null,
        }
      });
    }

    return NextResponse.json({
      success: true,
      settings: {
        watchTowerEnabled: settings.watchTowerEnabled,
        watchTowerUrl: settings.watchTowerUrl,
        watchTowerUsername: settings.watchTowerUsername,
        // Don't return password for security
        watchTowerAutoSync: settings.watchTowerAutoSync,
        watchTowerSyncInterval: settings.watchTowerSyncInterval,
        watchTowerLastSync: settings.watchTowerLastSync,
      }
    });
  } catch (error) {
    console.error("Error getting WatchTower settings:", error);
    return NextResponse.json(
      { error: "Failed to get WatchTower settings" },
      { status: 500 }
    );
  }
} 