import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl } from "@/lib/public-base-url";
import { createPlayerImageLinker } from "@/lib/plex-image";
import { authorizePlayer, linkParamsFor } from "@/lib/player-access";
import { keyParam } from "@/lib/espg-service-access";
import { createCollectionIconResolver } from "@/lib/plex-collection-icons";
import { firstProgramPosters } from "@/lib/first-program-posters";

export async function GET(request: NextRequest) {
  const access = await authorizePlayer(request, { scope: "guide", resource: "m3u" });
  if (!access.ok) return access.response;
  try {
    // Every link in the playlist carries this device's key (revocable in Settings)
    // and artwork carries a short-lived image pass.
    const links = (await linkParamsFor(access.auth));
    const channels = await prisma.channel.findMany({
      where: { stealth: false },
      orderBy: { number: 'asc' }
    });

    // Fetch global settings to check if catchup is enabled globally
    const globalSettings = await prisma.settings.findUnique({
      where: { id: "singleton" }
    });
    const globalCatchupEnabled = globalSettings?.catchupEnabled ?? true;

    // Links use the address the player actually used (scheme, host and port),
    // or the reverse proxy's public address when there is one.
    const baseUrl = getPublicBaseUrl(request.headers, request.url);


    // Helpers
    const isAbsolute = (url?: string | null) =>
      !!url && (/^(https?:)?\/\//i.test(url) || url.startsWith("/images/local/"));
    // Players load logos without a session, so Plex artwork links are signed.
    const playerImage = createPlayerImageLinker(
      await prisma.mediaServer.findMany({ where: { type: 'PLEX' }, select: { url: true, token: true } }),
      { pass: links.imagePass },
    );
    const toPlexProxy = (url: string): string => playerImage(url, baseUrl);

    // Pre-compute best icon for each channel using Plex posters where available
    const channelIconMap = new Map<string, string>();

    // Collection artwork via Plex, proxied; one collection fetch per library per build.
    const resolveCollectionIcon = createCollectionIconResolver({
      listLibraries: async () => {
        const servers = await prisma.mediaServer.findMany({
          where: { type: 'PLEX', active: true },
          include: { libraries: true }
        });
        return servers.flatMap((server) =>
          server.token
            ? server.libraries.map((lib) => ({ url: server.url, token: server.token as string, key: lib.key }))
            : [],
        );
      },
      toLink: (thumb, serverUrl) => toPlexProxy(new URL(thumb, serverUrl).toString()),
    });

    const needPoster: string[] = [];
    await Promise.all(
      channels.map(async (channel) => {
        // Prefer existing absolute channel icon if present and not a Plex URL with token
        if (isAbsolute(channel.icon)) {
          try {
            const u = new URL(channel.icon as string);
            if (!u.searchParams.has('X-Plex-Token')) {
              channelIconMap.set(channel.id, toPlexProxy(channel.icon as string));
              return;
            }
          } catch {}
        }

        // If channel uses collection filters, prefer the collection artwork
        let collections: string[] = [];
        try {
          collections = channel.filterCollections ? JSON.parse(channel.filterCollections) : [];
          if (!Array.isArray(collections)) collections = [];
        } catch { collections = []; }
        if (collections.length > 0) {
          const iconFromCollection = await resolveCollectionIcon(collections);
          if (iconFromCollection) {
            channelIconMap.set(channel.id, iconFromCollection);
            return;
          }
        }

        // Fallback (resolved below in one batch): the first programme's poster.
        needPoster.push(channel.id);
      })
    );
    for (const [channelId, poster] of await firstProgramPosters(needPoster)) {
      if (isAbsolute(poster)) channelIconMap.set(channelId, toPlexProxy(poster as string));
    }
    
    // Include EPG URL hints for players that support different keys
    const guideUrl = links.k ? `${baseUrl}/media.xml?k=${links.k}` : `${baseUrl}/media.xml`;
    let m3u = `#EXTM3U url-tvg="${guideUrl}" x-tvg-url="${guideUrl}"\n`;
    
    for (const channel of channels) {
      // Align tvg-id with XMLTV channel id: use the exact channel name
      let extinf = `#EXTINF:-1 tvg-id="${channel.name}" tvg-name="${channel.name}" tvg-chno="${channel.number}"`;
      
      if (channel.groupTitle) {
        extinf += ` group-title="${channel.groupTitle}"`;
      }
      
      const iconUrl = channelIconMap.get(channel.id) || (isAbsolute(channel.icon) ? (() => {
        try {
          const u = new URL(channel.icon as string);
          return toPlexProxy(u.toString());
        } catch {
          return undefined;
        }
      })() : undefined);
      if (iconUrl) {
        extinf += ` tvg-logo="${iconUrl}"`;
      }

      // Catchup / Timeshift attributes (IPTV standard catchup tags)
      // Supported by TiviMate, OTT Navigator, IPTV Smarters, and ESPG
      if (globalCatchupEnabled && channel.catchupEnabled) {
        const catchupDays = Math.ceil(channel.catchupWindowHours / 24);
        extinf += ` catchup="vod"`;
        extinf += ` catchup-days="${catchupDays}"`;
        // {start} = programme start (Unix s); {timestamp} = player wall clock — matches XMLTV template
        extinf += ` catchup-source="${baseUrl}/api/video?channel=${channel.number}&catchup=true&utc={start}&lutc={timestamp}${keyParam(links.k)}"`;
      }
      
      extinf += `,${channel.name}\n`;
      m3u += extinf;
      
      // Use a single video endpoint that will handle the streaming
      m3u += `${baseUrl}/api/video?channel=${channel.number}${keyParam(links.k)}\n`;
    }

    return new NextResponse(m3u, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Disposition': 'attachment; filename="twentyfourseven.m3u"',
        'Cache-Control': 'private, no-store',
      }
    });
  } catch (error) {
    console.error('Error generating M3U:', error);
    return NextResponse.json({ error: 'Failed to generate M3U playlist' }, { status: 500 });
  }
} 