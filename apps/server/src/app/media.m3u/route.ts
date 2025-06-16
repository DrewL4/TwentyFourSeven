import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const channels = await prisma.channel.findMany({
      where: { stealth: false },
      orderBy: { number: 'asc' }
    });

    const baseUrl = process.env.BASE_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    
    let m3u = '#EXTM3U\n';
    
    for (const channel of channels) {
      // Format: #EXTINF:-1 tvg-id="1" tvg-name="Channel Name" group-title="Group" tvg-logo="icon",Channel Name
      let extinf = `#EXTINF:-1 tvg-id="${channel.number}" tvg-name="${channel.name}"`;
      
      if (channel.groupTitle) {
        extinf += ` group-title="${channel.groupTitle}"`;
      }
      
      if (channel.icon) {
        extinf += ` tvg-logo="${channel.icon}"`;
      }
      
      extinf += `,${channel.name}\n`;
      m3u += extinf;
      
      // Use a single video endpoint that will handle the streaming
      m3u += `${baseUrl}/api/video?channel=${channel.number}\n`;
    }

    return new NextResponse(m3u, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Disposition': 'attachment; filename="dizquetv.m3u"'
      }
    });
  } catch (error) {
    console.error('Error generating M3U:', error);
    return NextResponse.json({ error: 'Failed to generate M3U playlist' }, { status: 500 });
  }
} 