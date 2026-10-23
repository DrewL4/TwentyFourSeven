import { promises as fs, realpathSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { isSystemFolder } from "./paths";
import { VIDEO_EXTENSIONS, isSampleFile, isSeasonDir, isSkippedDir, parseEpisodeName, parseMovieName } from "./parse";

/**
 * Folder picker for people who don't know what a container path is.
 *
 * Only the usual media mounts can be browsed. Every request is checked twice:
 * by name (no "..", no hidden Unraid shares) and by real path (symlinks must
 * stay inside the mount). Counting is sampled and time-boxed, so opening a
 * folder never walks a whole library.
 */

export const BROWSE_ROOTS = ["/movies", "/tv", "/media"];

/** Unraid system shares, NAS trash/thumbnail folders and dot-folders never show up. */
const HIDDEN = /^(appdata|system|domains|isos|lost\+found|@eadir|#recycle|#snapshot|\$recycle\.bin|system volume information|\..*)$/i;

export function isHiddenFolder(name: string): boolean {
  return HIDDEN.test(name.trim());
}

const MOVIES_NAME = /^(movies?|films?)$/i;
const TV_NAME = /^(tv|tv[ ._-]?shows?|shows?|series)$/i;
const SHOWS_HINT = /(^|[^a-z])(tv|shows?|series|anime)([^a-z]|$)/i;
const MOVIES_HINT = /movie|film/i;

export type Guess = "movies" | "shows" | "mixed" | null;

export type FolderEntry = {
  name: string;
  path: string;
  /** Videos seen in a quick look (a few levels deep). -1 when we ran out of time. */
  videos: number;
  /** True when the quick look stopped early, so there are more than `videos`. */
  more: boolean;
  guess: Guess;
  hasFolders: boolean;
};

export type Resolved = { root: string; path: string; real: string };

function realInside(realRoot: string, real: string): boolean {
  return real === realRoot || real.startsWith(realRoot + path.sep);
}

/**
 * Check a folder the browser asked for. Returns null unless it is one of the
 * roots or a visible folder inside one, and its real location (after
 * symlinks) is still inside that root.
 */
export function resolveBrowsePath(requested: unknown, roots: string[] = BROWSE_ROOTS): Resolved | null {
  if (typeof requested !== "string") return null;
  if (!requested || requested.length > 1024) return null;
  if (requested.includes("\0") || requested.includes("\\")) return null;
  if (!requested.startsWith("/")) return null;
  const trimmed = requested.length > 1 ? requested.replace(/\/+$/, "") : requested;
  const segs = trimmed.split("/").slice(1);
  if (segs.some((s) => s === "" || s === "." || s === "..")) return null;
  const root = roots.find((r) => trimmed === r || trimmed.startsWith(r + "/"));
  if (!root) return null;
  const below = trimmed.slice(root.length).split("/").filter(Boolean);
  if (below.some(isHiddenFolder)) return null;
  let realRoot: string;
  let real: string;
  try {
    realRoot = realpathSync(root);
    real = realpathSync(trimmed);
  } catch {
    return null;
  }
  if (isSystemFolder(realRoot) || !realInside(realRoot, real)) return null;
  try {
    if (!statSync(real).isDirectory()) return null;
  } catch {
    return null;
  }
  return { root, path: trimmed, real };
}

type Budget = { deadline: number; entries: number };

const newBudget = (ms: number, entries: number): Budget => ({ deadline: Date.now() + ms, entries });
const spent = (b: Budget) => Date.now() > b.deadline || b.entries <= 0;

/** Child folders we may show: visible, and symlinks only when they land inside the root. */
async function childFolders(abs: string, realRoot: string, entries?: Dirent[]): Promise<string[]> {
  let list = entries;
  if (!list) {
    try {
      list = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }
  }
  const out: string[] = [];
  for (const e of list) {
    if (isHiddenFolder(e.name)) continue;
    if (e.isDirectory()) {
      out.push(e.name);
    } else if (e.isSymbolicLink()) {
      try {
        const real = await fs.realpath(path.join(abs, e.name));
        if (realInside(realRoot, real) && (await fs.stat(real)).isDirectory()) out.push(e.name);
      } catch {
        // broken link
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** `deep` = some folders were deeper than we look, so the guess may miss things below. */
export type Sample = { videos: string[]; more: boolean; deep: boolean };

const MAX_SAMPLE_DEPTH = 4;
const MAX_SAMPLE_VIDEOS = 400;

/**
 * Look a few levels down for video files, stopping at the budget. Symlinked
 * folders are not followed (the scanner doesn't follow them either).
 */
export async function sampleVideos(abs: string, budget: Budget, perFolderEntries = 2500): Promise<Sample> {
  const videos: string[] = [];
  let more = false;
  let deep = false;
  let local = perFolderEntries;
  const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];
  while (queue.length) {
    if (spent(budget) || local <= 0 || videos.length >= MAX_SAMPLE_VIDEOS) {
      more = true;
      break;
    }
    const { rel, depth } = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(path.join(abs, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    budget.entries -= entries.length;
    local -= entries.length;
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (isHiddenFolder(e.name) || isSkippedDir(e.name)) continue;
        if (depth + 1 < MAX_SAMPLE_DEPTH) queue.push({ rel: childRel, depth: depth + 1 });
        else {
          more = true;
          deep = true;
        }
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext) && !isSampleFile(e.name)) videos.push(childRel);
      }
    }
  }
  return { videos, more, deep };
}

/** "Looks like Movies" / "Looks like TV shows" from names alone. */
export function guessKind(folderName: string, videos: string[]): Guess {
  if (videos.length === 0) return null;
  let episodes = 0;
  let dated = 0;
  for (const rel of videos) {
    const parts = rel.split("/");
    const file = parts[parts.length - 1];
    const parent = parts.length > 1 ? parts[parts.length - 2] : null;
    if (parts.slice(0, -1).some(isSeasonDir) || parseEpisodeName(file, parent) !== null) {
      episodes++;
    } else if (parseMovieName(file).year || (parent && parseMovieName(parent).year)) {
      dated++;
    }
  }
  const share = episodes / videos.length;
  const name = folderName.trim();
  if (share >= 0.7) return "shows";
  if (share <= 0.3) {
    const others = videos.length - episodes;
    if (MOVIES_HINT.test(name) || dated / others >= 0.5) return "movies";
    if (SHOWS_HINT.test(name) && episodes > 0) return "shows";
    return null;
  }
  if (SHOWS_HINT.test(name)) return "shows";
  if (MOVIES_HINT.test(name)) return "movies";
  return "mixed";
}

/** Roots that exist and have something in them. */
export async function mappedRoots(roots: string[] = BROWSE_ROOTS): Promise<string[]> {
  const out: string[] = [];
  for (const r of roots) {
    if (!resolveBrowsePath(r, roots)) continue;
    try {
      if ((await fs.readdir(r)).length > 0) out.push(r);
    } catch {
      // not mapped
    }
  }
  return out;
}

export type FolderListing = {
  path: string | null;
  parent: string | null;
  entries: FolderEntry[];
  truncated: boolean;
};

const MAX_LIST = 300;

/** One level of the picker. No path = the mapped roots. */
export async function listFolder(
  requested: string | null | undefined,
  roots: string[] = BROWSE_ROOTS,
  opts: { timeMs?: number } = {},
): Promise<FolderListing | null> {
  const budget = newBudget(opts.timeMs ?? 2500, 40_000);
  let names: Array<{ name: string; abs: string }>;
  let current: Resolved | null = null;
  let truncated = false;
  if (!requested) {
    names = (await mappedRoots(roots)).map((r) => ({ name: r, abs: r }));
  } else {
    current = resolveBrowsePath(requested, roots);
    if (!current) return null;
    const realRoot = realpathSync(current.root);
    const kids = await childFolders(current.path, realRoot);
    truncated = kids.length > MAX_LIST;
    names = kids.slice(0, MAX_LIST).map((n) => ({ name: n, abs: `${current!.path}/${n}` }));
  }
  const entries: FolderEntry[] = [];
  for (const { name, abs } of names) {
    const ok = resolveBrowsePath(abs, roots);
    if (!ok) continue;
    if (spent(budget)) {
      entries.push({ name, path: abs, videos: -1, more: true, guess: null, hasFolders: true });
      continue;
    }
    const sample = await sampleVideos(ok.real, budget, 2500);
    const hasFolders = (await childFolders(ok.path, realpathSync(ok.root))).length > 0;
    entries.push({
      name,
      path: abs,
      videos: sample.videos.length,
      more: sample.more,
      guess: trustedGuess(path.basename(abs), sample),
      hasFolders,
    });
  }
  let parent: string | null = null;
  if (current) {
    parent = current.path === current.root ? "" : path.posix.dirname(current.path);
  }
  return { path: current?.path ?? null, parent, entries, truncated };
}

/**
 * A guess from a shallow sample is only shown when the folder name agrees: a whole
 * share often has movies near the top and TV episodes deeper than the sample reads.
 */
function trustedGuess(name: string, sample: Sample): Guess {
  const guess = guessKind(name, sample.videos);
  if (!sample.deep || guess === "mixed" || guess === null) return guess;
  return (guess === "movies" ? MOVIES_HINT : SHOWS_HINT).test(name) ? guess : null;
}

const MAX_SUGGESTIONS = 12;

export type Suggestion = { path: string; kind: "movies" | "shows"; videos: number; more: boolean };

/**
 * "Find my videos": walk at most a few levels under each mapped root and
 * suggest the highest folders that look like Movies or TV. Time-boxed.
 */
export async function findVideoFolders(
  roots: string[] = BROWSE_ROOTS,
  opts: { timeMs?: number; maxDepth?: number } = {},
): Promise<{ suggestions: Suggestion[]; finished: boolean }> {
  const budget = newBudget(opts.timeMs ?? 6000, 150_000);
  const maxDepth = opts.maxDepth ?? 3;
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  async function visit(logical: string, depth: number) {
    if (spent(budget)) return;
    const ok = resolveBrowsePath(logical, roots);
    if (!ok) return;
    // The same host folder mapped twice (say /movies and /media/Movies) counts once.
    try {
      const st = await fs.stat(ok.real);
      const id = `${st.dev}:${st.ino}`;
      if (seen.has(id)) return;
      seen.add(id);
    } catch {
      return;
    }
    const realRoot = realpathSync(ok.root);
    const kids = await childFolders(ok.path, realRoot);
    const named = kids.filter((k) => MOVIES_NAME.test(k) || TV_NAME.test(k));
    if (named.length === 0) {
      const sample = await sampleVideos(ok.real, budget, 4000);
      if (sample.videos.length === 0 && !sample.more) return;
      const guess = guessKind(path.basename(ok.path), sample.videos);
      const base = path.basename(ok.path);
      const nameAgrees = guess === "movies" ? MOVIES_HINT.test(base) : SHOWS_HINT.test(base);
      // A broad folder (all of /mnt/user, say) can look like "movies" only
      // because the TV episodes sit deeper than we looked; go one level down.
      if ((guess === "movies" || guess === "shows") && (nameAgrees || !sample.deep)) {
        suggestions.push({ path: ok.path, kind: guess, videos: sample.videos.length, more: sample.more });
        return;
      }
      // Saw everything and it isn't clearly movies or TV (home videos,
      // downloads): stop, rather than suggesting every subfolder on its own.
      if (guess !== "mixed" && !sample.deep) return;
    }
    if (depth >= maxDepth || suggestions.length >= MAX_SUGGESTIONS) return;
    // Clearly named folders first, so they win if time runs out.
    const order = [...named, ...kids.filter((k) => !named.includes(k))];
    for (const k of order) await visit(`${ok.path}/${k}`, depth + 1);
  }

  for (const r of await mappedRoots(roots)) await visit(r, 0);
  const rank = (s: Suggestion) => (s.kind === "movies" ? 0 : 1);
  suggestions.sort((a, b) => rank(a) - rank(b) || b.videos - a.videos);
  return { suggestions, finished: !spent(budget) };
}

/**
 * Validate the folders the picker saves: each must pass resolveBrowsePath,
 * and a folder inside another picked folder is dropped (it would be indexed twice).
 */
export function cleanPickedFolders(folders: string[], roots: string[] = BROWSE_ROOTS): { kept: string[]; rejected: string[] } {
  const kept: string[] = [];
  const rejected: string[] = [];
  for (const f of folders) {
    const ok = resolveBrowsePath(f, roots);
    if (!ok) rejected.push(f);
    else if (!kept.includes(ok.path)) kept.push(ok.path);
  }
  const inside = (a: string, b: string) => a !== b && a.startsWith(b + "/");
  return { kept: kept.filter((k) => !kept.some((o) => inside(k, o))), rejected };
}
