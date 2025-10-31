import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    // TODO: Add admin authentication check here
    // For now, we'll return all users
    
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        watchTowerJoinDate: true,
        watchTowerMetadata: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform the response to match frontend expectations
    const transformedUsers = users.map(user => {
      const metadata = user.watchTowerMetadata as any;
      const movieDonationDue = metadata?.movie_donation_due || null;
      const isExpired = metadata?.movie_donation_expired || false;
      
      return {
        _id: user.id, // Map id to _id for frontend compatibility
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        watchTowerJoinDate: user.watchTowerJoinDate,
        movieDonationDue: movieDonationDue,
        isMovieExpired: isExpired,
      };
    });

    return NextResponse.json({ users: transformedUsers });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
} 