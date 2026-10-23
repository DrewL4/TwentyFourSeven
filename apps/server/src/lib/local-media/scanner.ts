import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../prisma";
import { configuredLocalRoots } from "./paths";
import {
  VIDEO_EXTENSIONS,
  isSampleFile,
  isSeasonDir,
  isSkippedDir,
  parseEpisodeName,
  parseMovieName,
  parseNfo,
  pickArtwork,
  type NfoInfo,
} from "./parse";

/**
 * Local files source. TwentyFourSeven reads the same folders ESPG/Plex use
 * (mounted read-only) and keeps its own small index, so playback never waits
 * on another service.
 *
 * Rescans are incremental: a file is probed with ffprobe only when its size
 * or modified time changed. Nothing is hashed.
 */

export const LOCAL_SERVER_URL = "local://files";
const MAX_DEPTH = 6;
const PROBE_CONCURRENCY = 2;

export type FolderStatus = {
  path: string;
  ok: boolean;
  kind: "movies" | "shows" | null;
  movies: number;
  shows: number;
  episodes: number;
  problem?: string;
};

export type LocalScanState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  probed: number;
  skippedUnchanged: number;
  removed: number;
  folders: FolderStatus[];
};

const state: LocalScanState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  probed: 0,
  skippedUnchanged: 0,
  removed: 0,
  folders: [],
};
let inFlight: Promise<LocalScanState> | null = null;

export function getLocalScanState(): LocalScanState {
  return { ...state, folders: state.folders.map((f) => ({ ...f })) };
}

type ProbeResult = {
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  width: number | null;
  height: number | null;
  pixFmt: string | null;
  durationMs: number | null;
};

export function probeFile(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "stream=codec_type,codec_name,channels,width,height,pix_fmt:format=duration",
        "-of", "json",
        file,
      ],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const data = JSON.parse(stdout) as {
            streams?: Array<{ codec_type?: string; codec_name?: string; channels?: number; width?: number; height?: number; pix_fmt?: string }>;
            format?: { duration?: string };
          };
          const v = data.streams?.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
          const a = data.streams?.find((s) => s.codec_type === "audio");
          const dur = Number(data.format?.duration);
          resolve({
            videoCodec: v?.codec_name ?? null,
            audioCodec: a?.codec_name ?? null,
            audioChannels: a?.channels ?? null,
            width: v?.width ?? null,
            height: v?.height ?? null,
            pixFmt: v?.pix_fmt ?? null,
            durationMs: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 1000) : null,
          });
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

type FoundVideo = { rel: string; size: number; mtimeMs: number; dirFiles: string[] };

async function walk(root: string): Promise<FoundVideo[]> {
  const out: FoundVideo[] = [];
  async function visit(dirRel: string, depth: number) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await fs.readdir(path.join(root, dirRel), { withFileTypes: true });
    } catch {
      return;
    }
    const names = entries.map((e) => e.name);
    for (const e of entries) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!isSkippedDir(e.name)) await visit(rel, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext) || isSampleFile(e.name)) continue;
      try {
        const st = await fs.stat(path.join(root, rel));
        if (st.size < 1024) continue;
        out.push({ rel, size: st.size, mtimeMs: Math.floor(st.mtimeMs), dirFiles: names });
      } catch {
        // vanished mid-scan
      }
    }
  }
  await visit("", 0);
  return out;
}

async function readNfo(root: string, rel: string): Promise<{ info: NfoInfo; mtimeMs: number } | null> {
  try {
    const abs = path.join(root, rel);
    const st = await fs.stat(abs);
    if (st.size > 512 * 1024) return null;
    return { info: parseNfo(await fs.readFile(abs, "utf8")), mtimeMs: Math.floor(st.mtimeMs) };
  } catch {
    return null;
  }
}

function findCaseInsensitive(files: string[], name: string): string | undefined {
  const l = name.toLowerCase();
  return files.find((f) => f.toLowerCase() === l);
}

function guessKind(root: string, videos: FoundVideo[]): "MOVIE" | "SHOW" {
  const base = path.basename(root).toLowerCase();
  if (/(^|[^a-z])(tv|shows?|series|anime|episodes?)([^a-z]|$)/.test(base)) return "SHOW";
  if (/movie|film/.test(base)) return "MOVIE";
  const eps = videos.filter((v) => {
    const parts = v.rel.split("/");
    return parseEpisodeName(parts[parts.length - 1], parts[parts.length - 2]) !== null;
  }).length;
  return eps > videos.length / 2 ? "SHOW" : "MOVIE";
}

function titleCaseFolder(p: string): string {
  const b = path.basename(p) || p;
  return b.length <= 3 ? b.toUpperCase() : b.charAt(0).toUpperCase() + b.slice(1);
}

async function expandRoots(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const r of roots) {
    // "/media" holding "Movies" and "TV": index each as its own library.
    try {
      const subs = (await fs.readdir(r, { withFileTypes: true })).filter((e) => e.isDirectory());
      const split = subs.filter((e) => /^(movies?|films?|tv|tv shows|shows|series)$/i.test(e.name));
      if (path.basename(r).toLowerCase() === "media" && split.length > 0) {
        for (const s of split) out.push(path.join(r, s.name));
        continue;
      }
    } catch {
      // reported in the folder status
    }
    out.push(r);
  }
  return out;
}

export async function ensureLocalServer() {
  const existing = await prisma.mediaServer.findFirst({ where: { type: "LOCAL" } });
  if (existing) return existing;
  return prisma.mediaServer.create({
    data: { name: "Local files", url: LOCAL_SERVER_URL, type: "LOCAL", active: true },
  });
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    }),
  );
}

const json = (v: string[]) => (v.length ? JSON.stringify(v) : null);

async function scanLibrary(root: string, serverId: string, counters: { probed: number; skipped: number; removed: number }): Promise<FolderStatus> {
  const status: FolderStatus = { path: root, ok: false, kind: null, movies: 0, shows: 0, episodes: 0 };
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) {
      status.problem = "not-a-folder";
      return status;
    }
    await fs.access(root, (await import("node:fs")).constants.R_OK);
  } catch {
    status.problem = "missing";
    return status;
  }

  const videos = await walk(root);
  const kind = guessKind(root, videos);
  status.kind = kind === "MOVIE" ? "movies" : "shows";
  const library = await prisma.mediaLibrary.upsert({
    where: { serverId_key: { serverId, key: root } },
    create: { serverId, key: root, name: titleCaseFolder(root), type: kind },
    update: {},
  });
  // A folder keeps the kind it was first indexed as (channels point at it).
  const libKind = library.type;
  status.kind = libKind === "MOVIE" ? "movies" : "shows";

  const known = new Map(
    (await prisma.localMediaItem.findMany({ where: { libraryId: library.id } })).map((r) => [r.relPath, r]),
  );
  const seen = new Set<string>();

  if (videos.length === 0) {
    status.ok = true;
    status.problem = "empty";
    return status;
  }

  if (libKind === "MOVIE") {
    await mapLimit(videos, PROBE_CONCURRENCY, async (v) => {
      seen.add(v.rel);
      const parts = v.rel.split("/");
      const file = parts[parts.length - 1];
      const dirRel = parts.slice(0, -1).join("/");
      const base = file.replace(/\.[^.]+$/, "");
      const videosInDir = v.dirFiles.filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()) && !isSampleFile(f));
      const nfoName = findCaseInsensitive(v.dirFiles, `${base}.nfo`) ?? (videosInDir.length === 1 ? findCaseInsensitive(v.dirFiles, "movie.nfo") : undefined);
      const nfo = nfoName ? await readNfo(root, dirRel ? `${dirRel}/${nfoName}` : nfoName) : null;
      const stamp = Math.max(v.mtimeMs, nfo?.mtimeMs ?? 0);
      const prev = known.get(v.rel);
      const existingMovie = prev ? await prisma.mediaMovie.findUnique({ where: { libraryId_ratingKey: { libraryId: library.id, ratingKey: v.rel } }, select: { id: true } }) : null;
      if (prev && prev.size === v.size && prev.mtimeMs === stamp && prev.durationMs && existingMovie) {
        counters.skipped++;
        return;
      }
      let probe: ProbeResult;
      try {
        probe = await probeFile(path.join(root, v.rel));
        counters.probed++;
      } catch (e) {
        await prisma.localMediaItem.upsert({
          where: { libraryId_relPath: { libraryId: library.id, relPath: v.rel } },
          create: { libraryId: library.id, relPath: v.rel, kind: "movie", size: v.size, mtimeMs: stamp, probeError: String((e as Error).message).slice(0, 300) },
          update: { size: v.size, mtimeMs: stamp, probeError: String((e as Error).message).slice(0, 300), scannedAt: new Date() },
        });
        return;
      }
      if (!probe.durationMs || !probe.videoCodec) return;
      const art = pickArtwork(v.dirFiles, base);
      const artRel = (f?: string) => (f ? (dirRel ? `${dirRel}/${f}` : f) : null);
      // Only use folder-level poster.jpg when the folder holds this one movie.
      const posterRel = art.poster && (videosInDir.length === 1 || art.poster.toLowerCase().startsWith(base.toLowerCase())) ? artRel(art.poster) : null;
      const backdropRel = art.backdrop && (videosInDir.length === 1 || art.backdrop.toLowerCase().startsWith(base.toLowerCase())) ? artRel(art.backdrop) : null;
      const item = await prisma.localMediaItem.upsert({
        where: { libraryId_relPath: { libraryId: library.id, relPath: v.rel } },
        create: { libraryId: library.id, relPath: v.rel, kind: "movie", size: v.size, mtimeMs: stamp, ...probe, posterRel, backdropRel },
        update: { size: v.size, mtimeMs: stamp, ...probe, probeError: null, posterRel, backdropRel, scannedAt: new Date() },
      });
      const fromName = videosInDir.length === 1 && dirRel ? parseMovieName(parts[parts.length - 2]) : parseMovieName(file);
      const n = nfo?.info;
      const data = {
        title: n?.title || fromName.title || base,
        year: n?.year ?? fromName.year,
        summary: n?.plot ?? null,
        duration: probe.durationMs,
        poster: posterRel ? `/images/local/${item.id}/poster` : null,
        backdrop: backdropRel ? `/images/local/${item.id}/backdrop` : null,
        studio: n?.studio ?? null,
        contentRating: n?.mpaa ?? null,
        genres: json(n?.genres ?? []),
        directors: json(n?.directors ?? []),
        actors: json(n?.actors ?? []),
        tmdbId: n?.tmdbId ?? null,
        imdbId: n?.imdbId ?? null,
      };
      await prisma.mediaMovie.upsert({
        where: { libraryId_ratingKey: { libraryId: library.id, ratingKey: v.rel } },
        create: { ...data, ratingKey: v.rel, libraryId: library.id },
        update: data,
      });
    });
  } else {
    // Shows: the first folder level under the root is the show.
    const byShow = new Map<string, FoundVideo[]>();
    for (const v of videos) {
      const parts = v.rel.split("/");
      if (parts.length < 2) continue; // loose files at the root of a TV folder
      const list = byShow.get(parts[0]) ?? [];
      list.push(v);
      byShow.set(parts[0], list);
    }
    for (const [showDir, eps] of byShow) {
      seen.add(showDir);
      let showFiles: string[] = [];
      try {
        showFiles = await fs.readdir(path.join(root, showDir));
      } catch {
        continue;
      }
      const nfoName = findCaseInsensitive(showFiles, "tvshow.nfo");
      const nfo = nfoName ? await readNfo(root, `${showDir}/${nfoName}`) : null;
      const art = pickArtwork(showFiles);
      const showItem = await prisma.localMediaItem.upsert({
        where: { libraryId_relPath: { libraryId: library.id, relPath: showDir } },
        create: { libraryId: library.id, relPath: showDir, kind: "show", mtimeMs: nfo?.mtimeMs ?? 0, posterRel: art.poster ? `${showDir}/${art.poster}` : null, backdropRel: art.backdrop ? `${showDir}/${art.backdrop}` : null },
        update: { mtimeMs: nfo?.mtimeMs ?? 0, posterRel: art.poster ? `${showDir}/${art.poster}` : null, backdropRel: art.backdrop ? `${showDir}/${art.backdrop}` : null, scannedAt: new Date() },
      });
      const fromName = parseMovieName(showDir);
      const n = nfo?.info;
      const showData = {
        title: n?.title || fromName.title || showDir,
        year: n?.year ?? fromName.year,
        summary: n?.plot ?? null,
        poster: art.poster ? `/images/local/${showItem.id}/poster` : null,
        backdrop: art.backdrop ? `/images/local/${showItem.id}/backdrop` : null,
        studio: n?.studio ?? null,
        contentRating: n?.mpaa ?? null,
        genres: json(n?.genres ?? []),
        actors: json(n?.actors ?? []),
      };
      const show = await prisma.mediaShow.upsert({
        where: { libraryId_ratingKey: { libraryId: library.id, ratingKey: showDir } },
        create: { ...showData, ratingKey: showDir, libraryId: library.id },
        update: showData,
      });
      status.shows++;

      const sorted = [...eps].sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
      await mapLimit(sorted.map((v, idx) => ({ v, idx })), PROBE_CONCURRENCY, async ({ v, idx }) => {
        seen.add(v.rel);
        const parts = v.rel.split("/");
        const file = parts[parts.length - 1];
        const parentDir = parts.length > 2 ? parts[parts.length - 2] : null;
        const parsed = parseEpisodeName(file, parentDir && isSeasonDir(parentDir) ? parentDir : null);
        const base = file.replace(/\.[^.]+$/, "");
        const nfoFile = findCaseInsensitive(v.dirFiles, `${base}.nfo`);
        const epNfo = nfoFile ? await readNfo(root, [...parts.slice(0, -1), nfoFile].join("/")) : null;
        const stamp = Math.max(v.mtimeMs, epNfo?.mtimeMs ?? 0);
        const prev = known.get(v.rel);
        if (prev && prev.size === v.size && prev.mtimeMs === stamp && prev.durationMs) {
          const exists = await prisma.mediaEpisode.findUnique({ where: { showId_ratingKey: { showId: show.id, ratingKey: v.rel } }, select: { id: true } });
          if (exists) {
            counters.skipped++;
            return;
          }
        }
        let probe: ProbeResult;
        try {
          probe = await probeFile(path.join(root, v.rel));
          counters.probed++;
        } catch (e) {
          await prisma.localMediaItem.upsert({
            where: { libraryId_relPath: { libraryId: library.id, relPath: v.rel } },
            create: { libraryId: library.id, relPath: v.rel, kind: "episode", size: v.size, mtimeMs: stamp, probeError: String((e as Error).message).slice(0, 300) },
            update: { size: v.size, mtimeMs: stamp, probeError: String((e as Error).message).slice(0, 300) },
          });
          return;
        }
        if (!probe.durationMs || !probe.videoCodec) return;
        await prisma.localMediaItem.upsert({
          where: { libraryId_relPath: { libraryId: library.id, relPath: v.rel } },
          create: { libraryId: library.id, relPath: v.rel, kind: "episode", size: v.size, mtimeMs: stamp, ...probe },
          update: { size: v.size, mtimeMs: stamp, ...probe, probeError: null, scannedAt: new Date() },
        });
        const season = epNfo?.info.season ?? parsed?.season ?? 1;
        const episode = epNfo?.info.episode ?? parsed?.episode ?? idx + 1;
        const data = {
          title: epNfo?.info.title || parsed?.title || base,
          summary: epNfo?.info.plot ?? null,
          duration: probe.durationMs,
          seasonNumber: season,
          episodeNumber: episode,
        };
        await prisma.mediaEpisode.upsert({
          where: { showId_ratingKey: { showId: show.id, ratingKey: v.rel } },
          create: { ...data, ratingKey: v.rel, showId: show.id },
          update: data,
        });
      });
      status.episodes += await prisma.mediaEpisode.count({ where: { showId: show.id } });
    }
  }

  // Remove what disappeared. Never wipe a folder that suddenly looks empty
  // (an unmounted share would otherwise delete every channel's content).
  const gone = [...known.keys()].filter((rel) => !seen.has(rel));
  if (gone.length && seen.size > 0) {
    for (const rel of gone) {
      const row = known.get(rel)!;
      if (row.kind === "movie") {
        await prisma.mediaMovie.deleteMany({ where: { libraryId: library.id, ratingKey: rel } });
      } else if (row.kind === "show") {
        await prisma.mediaShow.deleteMany({ where: { libraryId: library.id, ratingKey: rel } });
      } else {
        await prisma.mediaEpisode.deleteMany({ where: { ratingKey: rel, show: { libraryId: library.id } } });
      }
      await prisma.localMediaItem.delete({ where: { id: row.id } }).catch(() => undefined);
      counters.removed++;
    }
  }

  status.ok = true;
  if (libKind === "MOVIE") status.movies = await prisma.mediaMovie.count({ where: { libraryId: library.id } });
  else status.shows = await prisma.mediaShow.count({ where: { libraryId: library.id } });
  return status;
}

export async function scanLocalMedia(): Promise<LocalScanState> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
    state.running = true;
    state.startedAt = new Date().toISOString();
    state.lastError = null;
    const counters = { probed: 0, skipped: 0, removed: 0 };
    try {
      if (settings && settings.localMediaEnabled === false) {
        state.folders = [];
        return getLocalScanState();
      }
      const roots = await expandRoots(configuredLocalRoots(settings?.localMediaPaths));
      const server = await ensureLocalServer();
      const folders: FolderStatus[] = [];
      for (const root of roots) {
        folders.push(await scanLibrary(root, server.id, counters));
      }
      state.folders = folders;
    } catch (e) {
      state.lastError = (e as Error).message;
      console.error("[LocalMedia] scan failed:", (e as Error).message);
    } finally {
      state.running = false;
      state.finishedAt = new Date().toISOString();
      state.probed = counters.probed;
      state.skippedUnchanged = counters.skipped;
      state.removed = counters.removed;
      inFlight = null;
    }
    console.log(
      `[LocalMedia] scan done folders=${state.folders.length} probed=${counters.probed} unchanged=${counters.skipped} removed=${counters.removed}`,
    );
    return getLocalScanState();
  })();
  return inFlight;
}

let timer: NodeJS.Timeout | null = null;

export function startLocalMediaScheduler(): void {
  if (timer) return;
  const minutes = Math.max(5, Number(process.env.LOCAL_MEDIA_SCAN_MINUTES) || 60);
  setTimeout(() => void scanLocalMedia(), 5_000).unref?.();
  timer = setInterval(() => void scanLocalMedia(), minutes * 60_000);
  timer.unref?.();
}
