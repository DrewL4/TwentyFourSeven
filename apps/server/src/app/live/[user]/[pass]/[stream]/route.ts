import { NextRequest, NextResponse } from "next/server";
import { authorizePlayer } from "@/lib/player-access";
import { signLink } from "@/lib/link-security";
import { getPublicBaseUrl } from "@/lib/public-base-url";
import { parseLiveStream } from "@/lib/xtream";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Signed video links from /live are good for this long (only to start playback). */
const LIVE_LINK_TTL_SECONDS = 120;

/**
 * Xtream live address: /live/<username>/<password>/<channel>.ts (or .m3u8).
 * Checks the playlist login, then sends the player to a short-lived signed
 * /api/video link, so the password is not passed on.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ user: string; pass: string; stream: string }> }) {
  const { user, pass, stream } = await params;
  const parsed = parseLiveStream(decodeURIComponent(stream));
  if (!parsed) return new NextResponse("Unknown stream", { status: 404 });
  const url = new URL(request.nextUrl.toString());
  url.searchParams.set("username", decodeURIComponent(user));
  url.searchParams.set("password", decodeURIComponent(pass));
  const access = await authorizePlayer({ headers: request.headers, nextUrl: url }, { scope: "video", resource: `ch:${parsed.channel}`, allowLan: false });
  if (!access.ok) return access.response;
  // A channel that doesn't exist: say so here instead of signing a link to it.
  const channel = await prisma.channel.findUnique({ where: { number: parsed.channel }, select: { id: true } });
  if (!channel) return new NextResponse("Channel not found", { status: 404 });
  const sub = access.auth.userId ? `user:${access.auth.userId}` : `login:${decodeURIComponent(user)}`;
  const t = signLink("video", `ch:${parsed.channel}`, sub, LIVE_LINK_TTL_SECONDS);
  const base = getPublicBaseUrl(request.headers, request.url);
  return new NextResponse(null, {
    status: 302,
    headers: { Location: `${base}/api/video?channel=${parsed.channel}&t=${encodeURIComponent(t)}`, "Cache-Control": "no-store" },
  });
}

export const HEAD = GET;
