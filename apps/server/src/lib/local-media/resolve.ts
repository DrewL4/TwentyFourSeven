import { prisma } from "../prisma";
import { resolveInsideRoot } from "./paths";
import type { LocalProbe } from "./playback";

export type LocalStream = { filePath: string; probe: LocalProbe | null };

/** The real file behind a local library item, confined to its folder. */
export async function resolveLocalStream(
  library: { id: string; key: string },
  ratingKey: string,
): Promise<LocalStream | null> {
  const filePath = resolveInsideRoot(library.key, ratingKey);
  if (!filePath) return null;
  const item = await prisma.localMediaItem.findUnique({
    where: { libraryId_relPath: { libraryId: library.id, relPath: ratingKey } },
    select: { videoCodec: true, audioCodec: true, audioChannels: true, pixFmt: true },
  });
  return { filePath, probe: item };
}
