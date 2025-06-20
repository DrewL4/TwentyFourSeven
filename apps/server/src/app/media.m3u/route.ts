import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const channels = await prisma.channel.findMany({
      where: { stealth: false },
      orderBy: { number: 'asc' }
    });

    // Auto-detect the correct base URL from the request
    // Priority: X-Forwarded-Host (proxy) > Host header > fallback to environment
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('host');
    
    let baseUrl: string;
    if (forwardedHost) {
      // Behind a proxy (like Nginx Proxy Manager)
      baseUrl = `${forwardedProto}://${forwardedHost}`;
    } else if (host) {
      // Direct access
      baseUrl = `${request.nextUrl.protocol}//${host}`;
    } else {
      // Fallback to environment or localhost
      baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    }
    
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
        'Content-Disposition': 'attachment; filename="247.m3u"'
      }
    });
  } catch (error) {
    console.error('Error generating M3U:', error);
    return NextResponse.json({ error: 'Failed to generate M3U playlist' }, { status: 500 });
  }
} 