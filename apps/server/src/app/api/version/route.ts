import { NextResponse } from "next/server";
import { getBuildInfo } from "@/lib/build-info";

// Read the env at request time, never at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getBuildInfo());
}
