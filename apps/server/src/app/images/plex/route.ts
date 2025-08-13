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
  console.log('🔍 /images/plex route hit:', request.url);
  
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');
    const originParam = searchParams.get('origin');
    const pathParam = searchParams.get('path');

    console.log('🔍 Query params:', { rawUrl, originParam, pathParam });

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

    console.log('🔍 Parsed target:', { targetOrigin, targetPath, targetSearch });

    if (!targetOrigin || !targetPath) {
      console.log('❌ Missing parameters');
      return NextResponse.json({ error: 'Missing url or origin+path parameters' }, { status: 400 });
    }

    // Find the matching Plex server to get its token
    console.log('🔍 Looking for Plex server with origin:', targetOrigin);
    const server = await prisma.mediaServer.findFirst({
      where: {
        type: 'PLEX',
        url: targetOrigin
      }
    });

    console.log('🔍 Found server:', server ? { id: server.id, name: server.name, hasToken: !!server.token } : 'none');

    if (!server || !server.token) {
      console.log('❌ Server not found or no token');
      return NextResponse.json({ error: 'Plex server not found or not configured with token' }, { status: 404 });
    }

    const upstreamUrl = `${targetOrigin}${targetPath}${targetSearch}`;
    console.log('🔍 Fetching from upstream:', upstreamUrl);
    
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        'X-Plex-Token': server.token,
        'Accept': 'image/*'
      }
    });

    console.log('🔍 Upstream response status:', upstreamRes.status);

    if (!upstreamRes.ok) {
      console.log('❌ Upstream request failed');
      return new NextResponse(await upstreamRes.text(), { status: upstreamRes.status });
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await upstreamRes.arrayBuffer();

    console.log('✅ Successfully proxied image, size:', buffer.byteLength, 'bytes');

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    console.error('❌ Error proxying Plex image:', error);
    return NextResponse.json({ error: 'Failed to proxy image' }, { status: 500 });
  }
}
