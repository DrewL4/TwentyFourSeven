import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizePlayer } from "@/lib/player-access";
import { resolveInsideRoot } from "@/lib/local-media/paths";

export const dynamic = "force-dynamic";

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Poster or backdrop art found next to a local video (poster.jpg, fanart.jpg, ...).
 * The URL carries only the item id; the file path stays on the server and must
 * sit inside the item's media folder.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; art: string }> }) {
  const access = await authorizePlayer(request, { scope: "image", resource: "*" });
  if (!access.ok) return access.response;

  const { id, art } = await context.params;
  if ((art !== "poster" && art !== "backdrop") || !/^[a-z0-9]{10,40}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const item = await prisma.localMediaItem.findUnique({
    where: { id },
    select: { posterRel: true, backdropRel: true, libraryId: true },
  });
  const rel = art === "poster" ? item?.posterRel : item?.backdropRel;
  if (!item || !rel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const library = await prisma.mediaLibrary.findUnique({ where: { id: item.libraryId }, select: { key: true } });
  const filePath = library ? resolveInsideRoot(library.key, rel) : null;
  const type = IMAGE_TYPES[path.extname(rel).toLowerCase()];
  if (!filePath || !type) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error("not a usable image");
    const body = await fs.readFile(filePath);
    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": access.auth.via === "session" ? "private, max-age=86400" : "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        Vary: "Cookie",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
