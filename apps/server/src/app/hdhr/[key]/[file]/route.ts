import { NextRequest } from "next/server";
import { hdhrResponse } from "@/lib/hdhr-device";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ key: string; file: string }> }) {
  const { key, file } = await context.params;
  return hdhrResponse(request, file, key);
}
