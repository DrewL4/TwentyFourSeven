import { NextResponse } from "next/server";
import { buildLineupStatus } from "@/lib/hdhomerun";

export async function GET() {
  return NextResponse.json(buildLineupStatus(), {
    headers: { "Cache-Control": "no-cache" },
  });
}
