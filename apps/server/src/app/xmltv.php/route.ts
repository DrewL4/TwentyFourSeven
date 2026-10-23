import { NextRequest } from "next/server";
import { GET as guide } from "../media.xml/route";

export const dynamic = "force-dynamic";

/** Xtream-style guide address (xmltv.php?username=…&password=…) for IPTV apps. */
export async function GET(request: NextRequest) {
  return guide(request);
}
