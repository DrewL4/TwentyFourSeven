import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { decidePlexImageAccess } from "@/lib/plex-image-access";

/**
 * Proxy Plex artwork without exposing the Plex token to clients.
 *
 * Query: origin + path (preferred) or url (a full Plex URL; any token in it is ignored).
 * Only Plex artwork paths are fetched (/library/metadata/<id>/thumb|art, collection
 * artwork, /photo/:/transcode of those), and only from a configured Plex server.
 *
 * Access: a signed-in session (cookies; <img> tags send them) or a valid `sig`
 * (links in /media.m3u and /media.xml, which IPTV players load without a session).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const servers = await prisma.mediaServer.findMany({
      where: { type: "PLEX" },
      select: { url: true, token: true },
    });

    const decision = await decidePlexImageAccess({
      searchParams,
      servers,
      hasSession: async () => {
        const session = await auth.api.getSession({ headers: request.headers });
        return Boolean(session?.user?.id);
      },
    });

    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    const upstreamRes = await fetch(decision.upstreamUrl, {
      headers: { "X-Plex-Token": decision.token, Accept: "image/*" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstreamRes.ok) {
      return NextResponse.json({ error: "Image not available" }, { status: upstreamRes.status === 404 ? 404 : 502 });
    }

    const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return NextResponse.json({ error: "Upstream did not return an image" }, { status: 502 });
    }
    const buffer = await upstreamRes.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        // Session-authorized images must not be stored by shared caches/CDNs.
        "Cache-Control": decision.via === "signature" ? "public, max-age=86400" : "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        Vary: "Cookie",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to proxy image" }, { status: 500 });
  }
}
