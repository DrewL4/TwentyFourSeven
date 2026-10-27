import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEffectiveRole } from "@/lib/admin-auth";

/**
 * Custom session endpoint that includes role field
 * This wraps Better Auth's session endpoint and adds custom fields
 */
export async function GET(request: NextRequest) {
  try {
    // Get session from Better Auth
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ session: null, user: null });
    }

    // Fetch user from database to get role
    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, isActive: true }
    });
    // The role the server will act with (re-checked with WatchTower, fails closed).
    const role = await getEffectiveRole(session.user.id, prisma);

    // Return enhanced session with role
    const enhancedSession = {
      ...session,
      user: {
        ...session.user,
        role,
        isActive: dbUser?.isActive ?? true
      }
    };

    return NextResponse.json(enhancedSession);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

