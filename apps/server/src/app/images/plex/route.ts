import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Proxy Plex artwork without exposing Plex tokens to clients.
 *
 * Supported query params:
 * - url: full Plex image URL (token will be ignored if present)
 * - origin + path: explicitly provide origin and path (preferred)
 *
 * Example:
 *   /images/plex?origin=https%3A%2F%2Fmy-plex.plex.direct%3A32400&path=%2Flibrary%2Fmetadata%2F56%2Fthumb%2F1394
 */
export async function GET(request: NextRequest) {
  
  
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');
    const originParam = searchParams.get('origin');
    const pathParam = searchParams.get('path');

    

    let targetOrigin: string | null = null;
    let targetPath: string | null = null;
    let targetSearch: string = '';

    if (rawUrl) {
      const parsed = new URL(rawUrl);
      // Remove any token from incoming URL to avoid leaking it back out
      parsed.searchParams.delete('X-Plex-Token');
      targetOrigin = parsed.origin;
      targetPath = parsed.pathname;
      const sanitized = parsed.searchParams.toString();
      targetSearch = sanitized ? `?${sanitized}` : '';
    } else if (originParam && pathParam) {
      targetOrigin = originParam;
      targetPath = pathParam;
      // Note: pathParam may already include its own query string
      const parsed = new URL(`${originParam}${pathParam}`);
      parsed.searchParams.delete('X-Plex-Token');
      targetPath = parsed.pathname;
      const sanitized = parsed.searchParams.toString();
      targetSearch = sanitized ? `?${sanitized}` : '';
    }

    

    if (!targetOrigin || !targetPath) {
      
      return NextResponse.json({ error: 'Missing url or origin+path parameters' }, { status: 400 });
    }

    // Find the matching Plex server to get its token
    
    let server = await prisma.mediaServer.findFirst({
      where: {
        type: 'PLEX',
        url: targetOrigin
      }
    });

    // Fallback: match by host (protocol/port agnostic)
    if (!server) {
      try {
        const targetHost = new URL(targetOrigin).host; // e.g., 192-168-1-7...plex.direct:32400
        server = await prisma.mediaServer.findFirst({
          where: {
            type: 'PLEX',
            url: { contains: targetHost }
          }
        });
        
      } catch (e) {
        
      }
    }

    

    if (!server || !server.token) {
      
      return NextResponse.json({ error: 'Plex server not found or not configured with token' }, { status: 404 });
    }

    const upstreamUrl = `${targetOrigin}${targetPath}${targetSearch}`;
    
    
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        'X-Plex-Token': server.token,
        'Accept': 'image/*'
      }
    });

    

    if (!upstreamRes.ok) {
      
      return new NextResponse(await upstreamRes.text(), { status: upstreamRes.status });
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await upstreamRes.arrayBuffer();

    

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    
    return NextResponse.json({ error: 'Failed to proxy image' }, { status: 500 });
  }
}
