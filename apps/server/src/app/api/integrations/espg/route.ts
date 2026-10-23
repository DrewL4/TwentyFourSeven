import { NextRequest, NextResponse } from "next/server";
import { bearer, isEspgCaller } from "@/lib/espg-caller";
import { signLink } from "@/lib/link-security";
import { clearLoginCache } from "@/lib/playlist-login";

export const dynamic = "force-dynamic";

/** How long a link ESPG hands a viewer is good for (only to start playback). */
export const ESPG_SIGNED_LINK_TTL_SECONDS = 300;

/**
 * Server-to-server calls from ESPG (authenticated with ESPG's WatchTower app token):
 *  - {"action":"sign","channel":5,"viewer":"someone@example.com"}
 *      → a short-lived signed token for /api/video?channel=5&t=…, one per viewer,
 *        so ESPG playlists never carry a shared TwentyFourSeven login.
 *  - {"action":"logins-changed"} → forget cached ESPG login answers now.
 */
export async function POST(request: NextRequest) {
  if (!(await isEspgCaller(bearer(request.headers)))) {
    return NextResponse.json({ error: "Not an ESPG app token" }, { status: 401 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  if (body?.action === "logins-changed") {
    clearLoginCache();
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "sign") {
    const channel = Number(body.channel);
    if (!Number.isInteger(channel) || channel < 0 || channel > 999999) {
      return NextResponse.json({ error: "channel must be a channel number" }, { status: 400 });
    }
    const viewer = String(body.viewer || "").trim().slice(0, 200) || "viewer";
    const token = signLink("video", `ch:${channel}`, `espg:${viewer}`, ESPG_SIGNED_LINK_TTL_SECONDS);
    return NextResponse.json({
      ok: true,
      path: `/api/video?channel=${channel}&t=${encodeURIComponent(token)}`,
      token,
      expires_in: ESPG_SIGNED_LINK_TTL_SECONDS,
    });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
