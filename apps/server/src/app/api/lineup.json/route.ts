import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    // Get all non-stealth channels
    const channels = await prisma.channel.findMany({
      where: { stealth: false },
      orderBy: { number: 'asc' }
    });

    const baseUrl = process.env.BASE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    
    // HDHomeRun lineup format
    const lineup = channels.map(channel => ({
      GuideNumber: channel.number.toString(),
      GuideName: channel.name,
      URL: `${baseUrl}/api/video?channel=${channel.number}`,
      HD: 1,
      Favorite: 0
    }));

    return NextResponse.json(lineup, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Error generating lineup:', error);
    return NextResponse.json({ error: 'Failed to generate lineup' }, { status: 500 });
  }
} 