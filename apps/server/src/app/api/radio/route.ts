import { NextResponse } from "next/server";

/**
 * Retired: this endpoint redirected players straight to the media server with its
 * access token in the URL. Players now use /api/video, which keeps tokens on the server.
 */
export async function GET() {
  return NextResponse.json(
    { error: "This link is no longer supported. Use the playlist from TwentyFourSeven Settings." },
    { status: 410 },
  );
}
