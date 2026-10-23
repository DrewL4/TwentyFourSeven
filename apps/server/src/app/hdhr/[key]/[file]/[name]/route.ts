import { NextRequest } from "next/server";
import { hdhrResponse } from "../../../../../lib/hdhr-device";

export const dynamic = "force-dynamic";

/**
 * HDHomeRun address with a playlist login: /hdhr/<username>/<password>/discover.json
 * Next.js needs the same slug names as the /hdhr/<key>/<file> route at each
 * level, so here `key` is the username, `file` the password and `name` the file.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ key: string; file: string; name: string }> },
) {
  const { key, file, name } = await context.params;
  return hdhrResponse(request, name, undefined, { username: key, password: file });
}
