import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password, source } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      // User exists (from WatchTower import), but we need to delete it
      // and let Better Auth create a new one with proper password hashing
      
      // First delete any existing accounts for this user
      await prisma.account.deleteMany({
        where: { userId: existingUser.id }
      });
      
      // Then delete the user
      await prisma.user.delete({
        where: { id: existingUser.id }
      });
    }

    // Now create user with credentials using Better Auth (which handles password hashing correctly)
    const result = await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
        callbackURL: undefined
      }
    });

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create admin account" },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      action: existingUser ? "replaced" : "created",
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        emailVerified: result.user.emailVerified,
      }
    });
  } catch (error) {
    console.error("Error creating admin:", error);
    
    // Handle specific Better Auth errors
    if (error instanceof Error) {
      if (error.message.includes("already exists") || error.message.includes("duplicate")) {
        return NextResponse.json(
          { error: "User with this email already exists" },
          { status: 409 }
        );
      }
    }
    
    return NextResponse.json(
      { error: "Failed to create admin account" },
      { status: 500 }
    );
  }
} 