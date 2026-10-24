import { createReadStream, createWriteStream } from "fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { once } from "events";
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

// On globalThis so every bundle that imports this module (API router, guide routes) shares one counter.
const shared = globalThis as typeof globalThis & { __tfsXmltvGeneration?: number };
let tmpSeq = 0;
/** Bumped on every invalidation, so a build that started before it is known to be stale. */
export function xmlTvCacheGeneration(): number {
  return shared.__tfsXmltvGeneration ?? 0;
}
/** Each writer gets its own temp file; two writers on one temp file interleave into a broken guide. */
function tmpPathFor(filePath: string): string {
  tmpSeq += 1;
  return `${filePath}.${process.pid}.${tmpSeq}.tmp`;
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
  const tmp = tmpPathFor(filePath);
  await writeFile(tmp, xml, "utf8");
  await rename(tmp, filePath);
}

/** Stream XMLTV to disk to avoid holding the full guide string in memory. */
export async function writeXmlTvCacheStreaming(
  writeLines: (write: (line: string) => Promise<void>) => Promise<void>,
): Promise<void> {
  const filePath = getXmlTvCachePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = tmpPathFor(filePath);
  const stream = createWriteStream(tmp, { encoding: "utf8" });
  // Wait for the disk to catch up instead of queueing the whole guide in the stream's buffer.
  const write = async (line: string) => {
    if (!stream.write(`${line}\n`)) await once(stream, "drain");
  };

  try {
    await writeLines(write);
    stream.end();
    await finished(stream);
    await rename(tmp, filePath);
  } catch (error) {
    // The file may still be opening; remove it only once the stream has closed.
    stream.destroy();
    await finished(stream).catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function invalidateXmlTvCache(): Promise<void> {
  shared.__tfsXmltvGeneration = xmlTvCacheGeneration() + 1;
  const filePath = getXmlTvCachePath();
  try {
    const tmp = `${filePath}.stale`;
    await rename(filePath, tmp).catch(() => undefined);
  } catch {
    // no cache file
  }
}

/**
 * The cached guide is shared by every client, but each client reached us at a
 * different address (LAN IP and port, proxy domain, ...). The guide is written
 * with this placeholder and the real address is filled in per request.
 */
export const XMLTV_BASE_URL_PLACEHOLDER = "@@TFS_PUBLIC_BASE_URL@@";
/** The caller's device key (`k=`), filled in per request so the shared cache holds no secrets. */
export const XMLTV_LINK_KEY_PLACEHOLDER = "@@TFS_LINK_KEY@@";
/** The caller's short-lived image pass (`t=`). */
export const XMLTV_IMAGE_PASS_PLACEHOLDER = "@@TFS_IMAGE_PASS@@";

/** Old builds stored collection artwork with a hard-coded public domain. */
const LEGACY_ICON_BASE = "https://247.midweststreams.us";

/** Turn a stored channel icon (relative `/images/...` or legacy absolute) into a placeholder URL. */
export function toPlaceholderIconUrl(icon: string): string {
  if (icon.startsWith("/")) return `${XMLTV_BASE_URL_PLACEHOLDER}${icon}`;
  if (icon.startsWith(`${LEGACY_ICON_BASE}/images/`)) {
    return `${XMLTV_BASE_URL_PLACEHOLDER}${icon.slice(LEGACY_ICON_BASE.length)}`;
  }
  return icon;
}

/**
 * Stream transform that swaps the placeholder for the caller's base URL.
 * Works line by line so a placeholder split across chunks is still replaced.
 */
export function replaceBaseUrlPlaceholder(
  source: Readable,
  replacement: string,
  /** Per-client values: the device key and image pass (see XMLTV_*_PLACEHOLDER). */
  extra: Record<string, string> = {},
): Readable {
  const pairs: Array<[string, string]> = [[XMLTV_BASE_URL_PLACEHOLDER, replacement], ...Object.entries(extra)];
  const fill = (text: string) => pairs.reduce((acc, [from, to]) => acc.split(from).join(to), text);
  async function* run() {
    let pending = "";
    for await (const chunk of source) {
      pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lastNewline = pending.lastIndexOf("\n");
      if (lastNewline === -1) continue;
      const complete = pending.slice(0, lastNewline + 1);
      pending = pending.slice(lastNewline + 1);
      yield fill(complete);
    }
    if (pending) yield fill(pending);
  }
  return Readable.from(run());
}
