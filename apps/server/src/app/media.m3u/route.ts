import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl } from "@/lib/public-base-url";
import { createPlayerImageLinker } from "@/lib/plex-image";
import { authorizePlayer, linkParamsFor } from "@/lib/player-access";
import { keyParam } from "@/lib/espg-service-access";

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

    // Helper to resolve collection artwork via Plex and proxy it
    const resolveCollectionIcon = async (collectionNames: string[]): Promise<string | null> => {
      if (!collectionNames || collectionNames.length === 0) return null;
      try {
        const servers = await prisma.mediaServer.findMany({
          where: { type: 'PLEX', active: true },
          include: { libraries: true }
        });
        for (const server of servers) {
          if (!server.token) continue;
          for (const lib of server.libraries) {
            try {
              const res = await fetch(`${server.url}/library/sections/${lib.key}/collections`, {
                headers: { 'Accept': 'application/json', 'X-Plex-Token': server.token }
              });
              if (!res.ok) continue;
              const data = await res.json();
              const directories = data?.MediaContainer?.Directory || [];
              for (const d of directories) {
                if (collectionNames.includes(d.title) && d.thumb) {
                  return toPlexProxy(new URL(d.thumb, server.url).toString());
                }
              }
            } catch {}
          }
        }
      } catch {}
      return null;
    };

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

        // Fallback: use the first available poster from current/any programme for this channel
        const program = await prisma.program.findFirst({
          where: { channelId: channel.id },
          orderBy: { startTime: 'asc' },
          include: {
            episode: { include: { show: true } },
            movie: true,
          },
        });

        const poster = program?.episode?.show?.poster || program?.movie?.poster || null;
        if (isAbsolute(poster)) {
          channelIconMap.set(channel.id, toPlexProxy(poster as string));
        }
      })
    );
    
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