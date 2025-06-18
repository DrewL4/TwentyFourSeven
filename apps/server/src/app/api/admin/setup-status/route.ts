import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Check if there are any users in the database
    const userCount = await prisma.user.count();
    
    return NextResponse.json({
      needsSetup: userCount === 0,
      userCount,
      message: userCount === 0 
        ? "Database is empty - first time setup required" 
        : `Database has ${userCount} users`
    });
    
  } catch (error) {
    console.error("Setup status check failed:", error);
    return NextResponse.json(
      { error: "Failed to check setup status" },
      { status: 500 }
    );
  }
} 