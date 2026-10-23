import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export const DEFAULT_LOCAL_ROOTS = ["/movies", "/tv", "/media"];

const SYSTEM_FOLDERS = ["/app", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var"];

/** The container's own folders (and "/") can never be media folders. */
export function isSystemFolder(p: string): boolean {
  const norm = path.resolve(p);
  return norm === "/" || SYSTEM_FOLDERS.some((s) => norm === s || norm.startsWith(s + "/"));
}

/**
 * A usual mount point counts only when something is in it. Base images ship an
 * empty /media, and warning "/media has no videos" to someone who only mapped
 * /movies and /tv would send them chasing a problem they don't have.
 */
function hasEntries(p: string): boolean {
  try {
    return readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

/**
 * /media is often mapped to a whole disk or share (Unraid: /mnt/user, which
 * includes appdata). Scan it on its own only when it plainly holds a Movies or
 * TV folder; otherwise the person picks folders inside it in Settings.
 */
function usableDefault(p: string): boolean {
  if (!hasEntries(p)) return false;
  if (path.basename(p).toLowerCase() !== "media") return true;
  try {
    return readdirSync(p, { withFileTypes: true }).some(
      (e) => e.isDirectory() && /^(movies?|films?|tv|tv shows|shows|series)$/i.test(e.name),
    );
  } catch {
    return false;
  }
}

/** Folders to scan: settings first, then LOCAL_MEDIA_PATHS, then the usual mounts. */
export function configuredLocalRoots(
  settingValue?: string | null,
  env: Record<string, string | undefined> = process.env,
  defaults: string[] = DEFAULT_LOCAL_ROOTS,
): string[] {
  const raw = (settingValue || "").trim() || (env.LOCAL_MEDIA_PATHS || "").trim();
  const list = raw
    ? raw.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)
    : defaults.filter(usableDefault);
  const out: string[] = [];
  for (const p of list) {
    if (!path.isAbsolute(p)) continue;
    const norm = path.resolve(p);
    if (isSystemFolder(norm)) continue;
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * Turn a library-relative path into a real file inside `root`, or null.
 * Rejects absolute paths, `..`, NUL bytes, and symlinks that point outside.
 */
export function resolveInsideRoot(root: string, relPath: string): string | null {
  if (!root || typeof relPath !== "string" || !relPath) return null;
  if (relPath.includes("\0") || relPath.includes("\\")) return null;
  if (path.isAbsolute(relPath)) return null;
  const parts = relPath.split("/");
  if (parts.some((p) => p === ".." || p === ".")) return null;
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  const joined = path.resolve(realRoot, relPath);
  if (joined !== realRoot && !joined.startsWith(realRoot + path.sep)) return null;
  let real: string;
  try {
    real = realpathSync(joined);
  } catch {
    return null;
  }
  if (!real.startsWith(realRoot + path.sep)) return null;
  try {
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return real;
}
