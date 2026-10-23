import { NextRequest } from "next/server";
import { hdhrResponse } from "@/lib/hdhr-device";

export async function GET(request: NextRequest) {
  return hdhrResponse(request, "lineup.json");
}
