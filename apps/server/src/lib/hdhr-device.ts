import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getPublicBaseUrl } from "./public-base-url";
import { buildLineupStatus } from "./hdhomerun";
import { authorizePlayer, linkParamsFor } from "./player-access";

type Req = { headers: Headers; nextUrl: URL; url: string };

/**
 * HDHomeRun clients (Plex DVR, Jellyfin, Emby, Channels) only know a base address and
 * append /discover.json, /lineup.json, ... to it. So the device key rides in the path:
 * http://host/hdhr/<key>/discover.json. Root /discover.json answers with that keyed base.
 */
export async function hdhrResponse(
  request: Req,
  file: string,
  pathKey?: string,
  pathLogin?: { username: string; password: string },
) {
  const url = new URL(request.nextUrl.toString());
  if (pathKey) url.searchParams.set("k", pathKey);
  if (pathLogin) {
    url.searchParams.set("username", pathLogin.username);
    url.searchParams.set("password", pathLogin.password);
  }
  const access = await authorizePlayer({ headers: request.headers, nextUrl: url }, { scope: "guide", resource: "hdhr" });
  if (!access.ok) return access.response;

  const k = (await linkParamsFor(access.auth)).k;
  const baseUrl = process.env.BASE_URL || getPublicBaseUrl(request.headers, request.url);
  const deviceBase = `${baseUrl}/hdhr/${k}`;
  const headers = { "Cache-Control": "private, no-cache" };

  if (file === "discover.json") {
    return NextResponse.json(
      {
        FriendlyName: "TwentyFourSeven",
        Manufacturer: "Silicondust",
        ModelNumber: "HDTC-2US",
        FirmwareName: "hdhomerun3_atsc",
        TunerCount: 6,
        FirmwareVersion: "20150826",
        DeviceID: "12345678",
        DeviceAuth: "test1234",
        BaseURL: deviceBase,
        LineupURL: `${deviceBase}/lineup.json`,
      },
      { headers },
    );
  }
  if (file === "lineup.json") {
    const channels = await prisma.channel.findMany({ where: { stealth: false }, orderBy: { number: "asc" } });
    return NextResponse.json(
      channels.map((channel) => ({
        GuideNumber: channel.number.toString(),
        GuideName: channel.name,
        URL: `${baseUrl}/api/video?channel=${channel.number}&k=${k}`,
        HD: 1,
        Favorite: 0,
      })),
      { headers },
    );
  }
  if (file === "lineup_status.json") {
    return NextResponse.json(buildLineupStatus(), { headers });
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
