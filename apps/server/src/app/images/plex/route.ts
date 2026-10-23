import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizePlayer } from "@/lib/player-access";
import { decidePlexImageAccess } from "@/lib/plex-image-access";

/**
 * Proxy Plex artwork without exposing the Plex token to clients.
 *
 * Query: origin + path (preferred) or url (a full Plex URL; any token in it is ignored).
 * Only Plex artwork paths are fetched (/library/metadata/<id>/thumb|art, collection
 * artwork, /photo/:/transcode of those), and only from a configured Plex server.
 *
 * Access: a signed-in session (cookies; <img> tags send them), a short-lived
 * image pass `t` (links in /media.m3u and /media.xml, which IPTV players load
 * without a session), a device key, or the home network when that is allowed.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await authorizePlayer(request, { scope: "image", resource: "*" });
    if (!access.ok) return access.response;
    const { searchParams } = new URL(request.url);
    const servers = await prisma.mediaServer.findMany({
      where: { type: "PLEX" },
      select: { url: true, token: true },
    });

    const decision = await decidePlexImageAccess({
      searchParams,
      servers,
      hasSession: async () => true,
      acceptSignature: false,
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
        "Cache-Control": access.auth.via === "session" ? "private, max-age=86400" : "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        Vary: "Cookie",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to proxy image" }, { status: 500 });
  }
}
