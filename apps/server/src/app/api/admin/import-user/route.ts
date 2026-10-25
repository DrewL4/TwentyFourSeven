import { guardAdminRoute } from '@/lib/admin-route-guard';
import { NextRequest, NextResponse } from "next/server";
import { importWatchTowerUser } from "@/lib/import-watchtower-user";

export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { action, user } = await importWatchTowerUser(body);

    return NextResponse.json({ 
      success: true, 
      action,
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
