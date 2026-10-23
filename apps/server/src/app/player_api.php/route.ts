import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl } from "@/lib/public-base-url";
import { authorizePlayer, linkParamsFor } from "@/lib/player-access";
import { createPlayerImageLinker } from "@/lib/plex-image";
import { epgListings, liveCategories, liveStreams, serverInfo, userInfo, type XtreamChannel } from "@/lib/xtream";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Xtream Codes API for IPTV apps (TiviMate, IPTV Smarters…). Uses the same
 * playlist login as get.php: TwentyFourSeven's own, or ESPG's when linked.
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const username = (p.get("username") || "").trim();
  const password = (p.get("password") || "").trim();
  if (!username || !password) return json({ user_info: { auth: 0 } });
  const access = await authorizePlayer(request, { scope: "guide", resource: "xtream", allowLan: false });
  if (!access.ok) {
    if (access.response.status === 503 || access.response.status === 429) return access.response;
    return json({ user_info: { auth: 0 } });
  }
  const now = new Date();
  const baseUrl = getPublicBaseUrl(request.headers, request.url);
  const action = p.get("action") || "";

  if (!action) {
    return json({ user_info: userInfo({ username, password }, now), server_info: serverInfo(baseUrl, now) });
  }

  const channels = (await prisma.channel.findMany({
    where: { stealth: false },
    orderBy: { number: "asc" },
    select: { id: true, number: true, name: true, groupTitle: true, icon: true, createdAt: true },
  })) as Array<XtreamChannel & { id: string }>;

  switch (action) {
    case "get_live_categories":
      return json(liveCategories(channels));
    case "get_live_streams": {
      const links = await linkParamsFor(access.auth);
      const playerImage = createPlayerImageLinker(
        await prisma.mediaServer.findMany({ where: { type: "PLEX" }, select: { url: true, token: true } }),
        { pass: links.imagePass },
      );
      const icon = (c: XtreamChannel) => {
        if (!c.icon || (!/^(https?:)?\/\//i.test(c.icon) && !c.icon.startsWith("/images/local/"))) return "";
        try {
          return playerImage(c.icon, baseUrl);
        } catch {
          return "";
        }
      };
      return json(liveStreams(channels, icon, p.get("category_id")));
    }
    case "get_vod_categories":
    case "get_series_categories":
    case "get_vod_streams":
    case "get_series":
      return json([]);
    case "get_short_epg":
    case "get_simple_data_table": {
      const id = Number(p.get("stream_id"));
      const channel = channels.find((c) => c.number === id);
      if (!channel) return json({ epg_listings: [] });
      const full = action === "get_simple_data_table";
      const limit = full ? 200 : Math.min(Math.max(Number(p.get("limit")) || 4, 1), 50);
      const programs = await prisma.program.findMany({
        where: {
          channelId: channel.id,
          startTime: full ? { gte: new Date(now.getTime() - 12 * 3600_000) } : { gte: new Date(now.getTime() - 24 * 3600_000) },
        },
        orderBy: { startTime: "asc" },
        take: full ? limit : limit + 50,
        include: { episode: { include: { show: true } }, movie: true },
      });
      const rows = programs
        .filter((pr) => full || pr.startTime.getTime() + pr.duration > now.getTime())
        .slice(0, limit)
        .map((pr) => ({
          id: pr.id,
          startTime: pr.startTime,
          durationMs: pr.duration,
          title: pr.movie?.title ?? (pr.episode ? `${pr.episode.show?.title ?? ""} - ${pr.episode.title}`.replace(/^ - /, "") : "TwentyFourSeven"),
          description: pr.movie?.summary ?? pr.episode?.summary ?? "",
        }));
      return json({ epg_listings: epgListings(channel, rows, now, full) });
    }
    default:
      return json({ error: "Unknown action" }, 400);
  }
}

export const POST = GET;
