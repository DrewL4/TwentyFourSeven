import { NextRequest } from "next/server";
import { GET as playlist } from "../media.m3u/route";

export const dynamic = "force-dynamic";

/** Xtream-style playlist address (get.php?username=…&password=…&type=m3u_plus) for IPTV apps. */
export async function GET(request: NextRequest) {
  return playlist(request);
}
