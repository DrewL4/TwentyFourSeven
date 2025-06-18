import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    // TODO: Add admin authentication check here
    
    const body = await request.json();
    const { name, email, emailVerified, source, originalJoinDate } = body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    let user;
    const now = new Date();

    if (existingUser) {
      // Update existing user with new information from WatchTower
      const updateData: any = {
        name: name || existingUser.name, // Keep existing name if new one is empty
        emailVerified: emailVerified || existingUser.emailVerified,
        updatedAt: now,
        // Note: Don't update createdAt - preserve original creation date
      };

      // Update watchTowerJoinDate if provided and not already set
      if (originalJoinDate && !existingUser.watchTowerJoinDate) {
        updateData.watchTowerJoinDate = new Date(originalJoinDate);
      }

      user = await prisma.user.update({
        where: { email },
        data: updateData
      });
    } else {
      // Create new user with all required fields
      // Use original join date from WatchTower if provided, otherwise use current time
      const joinDate = originalJoinDate ? new Date(originalJoinDate) : now;
      
      user = await prisma.user.create({
        data: {
          id: randomUUID(),
          name,
          email,
          emailVerified: emailVerified || false,
          createdAt: joinDate, // Use WatchTower join date
          updatedAt: now,
          watchTowerJoinDate: originalJoinDate ? new Date(originalJoinDate) : null,
          // Note: No password is set - user will need to use "forgot password" to set one
        }
      });
    }

    return NextResponse.json({ 
      success: true, 
      action: existingUser ? "updated" : "created",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      }
    });
  } catch (error) {
    console.error("Error importing user:", error);
    return NextResponse.json(
      { error: "Failed to import user" },
      { status: 500 }
    );
  }
} 