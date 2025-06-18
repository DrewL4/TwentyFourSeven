import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WatchTowerService } from "@/lib/watchtower-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      watchTowerEnabled,
      watchTowerUrl,
      watchTowerUsername,
      watchTowerPassword,
      watchTowerAutoSync,
      watchTowerSyncInterval,
      watchTowerLastSync
    } = body;

    // Get or create settings record
    let settings = await prisma.settings.findUnique({
      where: { id: "singleton" }
    });

    // Encrypt the password if provided
    let encryptedPassword = "";
    if (watchTowerPassword) {
      const watchTowerService = WatchTowerService.getInstance();
      encryptedPassword = watchTowerService.encryptPassword(watchTowerPassword);
    } else if (settings?.watchTowerPassword) {
      // Keep existing password if no new password provided
      encryptedPassword = settings.watchTowerPassword;
    }

    const settingsData = {
      watchTowerEnabled: watchTowerEnabled || false,
      watchTowerUrl: watchTowerUrl || "",
      watchTowerUsername: watchTowerUsername || "",
      watchTowerPassword: encryptedPassword,
      watchTowerAutoSync: watchTowerAutoSync || false,
      watchTowerSyncInterval: watchTowerSyncInterval || 24,
      watchTowerLastSync: watchTowerLastSync ? new Date(watchTowerLastSync) : null,
      updatedAt: new Date(),
    };

    if (settings) {
      // Update existing settings
      settings = await prisma.settings.update({
        where: { id: "singleton" },
        data: settingsData
      });
    } else {
      // Create new settings record
      settings = await prisma.settings.create({
        data: {
          id: "singleton",
          ...settingsData,
          createdAt: new Date(),
        }
      });
    }

    return NextResponse.json({ 
      success: true,
      settings: {
        watchTowerEnabled: settings.watchTowerEnabled,
        watchTowerUrl: settings.watchTowerUrl,
        watchTowerUsername: settings.watchTowerUsername,
        watchTowerAutoSync: settings.watchTowerAutoSync,
        watchTowerSyncInterval: settings.watchTowerSyncInterval,
        watchTowerLastSync: settings.watchTowerLastSync,
      }
    });
  } catch (error) {
    console.error("Error saving WatchTower settings:", error);
    return NextResponse.json(
      { error: "Failed to save WatchTower settings" },
      { status: 500 }
    );
  }
} 