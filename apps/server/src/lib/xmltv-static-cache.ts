import { createReadStream, createWriteStream } from "fs";
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { finished } from "stream/promises";

const DEFAULT_PATH = path.join(
  process.cwd(),
  "static",
  "xmltv.cached.xml",
);

export function getXmlTvCachePath(): string {
  return process.env.XMLTV_STATIC_PATH || DEFAULT_PATH;
}

export async function readXmlTvCacheIfFresh(
  maxAgeMs: number,
): Promise<string | null> {
  const filePath = getXmlTvCachePath();
  try {
    const info = await stat(filePath);
    if (Date.now() - info.mtimeMs > maxAgeMs) {
      return null;
    }
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/** Stream a fresh on-disk XMLTV cache without loading the full guide into heap. */
export async function openXmlTvCacheStreamIfFresh(
  maxAgeMs: number,
): Promise<Readable | null> {
  const filePath = getXmlTvCachePath();
  try {
    const info = await stat(filePath);
    if (Date.now() - info.mtimeMs > maxAgeMs) {
      return null;
    }
    return createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return null;
  }
}

export async function writeXmlTvCache(xml: string): Promise<void> {
  const filePath = getXmlTvCachePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, xml, "utf8");
  await rename(tmp, filePath);
}

/** Stream XMLTV to disk to avoid holding the full guide string in memory. */
export async function writeXmlTvCacheStreaming(
  writeLines: (write: (line: string) => void) => Promise<void>,
): Promise<void> {
  const filePath = getXmlTvCachePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  const stream = createWriteStream(tmp, { encoding: "utf8" });
  const write = (line: string) => {
    stream.write(`${line}\n`);
  };

  try {
    await writeLines(write);
    stream.end();
    await finished(stream);
    await rename(tmp, filePath);
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export async function invalidateXmlTvCache(): Promise<void> {
  const filePath = getXmlTvCachePath();
  try {
    const tmp = `${filePath}.stale`;
    await rename(filePath, tmp).catch(() => undefined);
  } catch {
    // no cache file
  }
}
