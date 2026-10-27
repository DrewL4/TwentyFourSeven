import path from 'node:path';

/** Only these hosts may be handed to yt-dlp; nothing else is ever fetched. */
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export function parseYoutubeUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'That is not a web address.' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'The address must start with https://' };
  if (!YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) {
    return { ok: false, reason: 'Only YouTube addresses (youtube.com, youtu.be) are allowed.' };
  }
  if (u.username || u.password) return { ok: false, reason: 'The address cannot contain a login.' };
  return { ok: true, url: u.toString() };
}

/** A name that is safe as a folder: no slashes, dots-only names or control characters. */
export function safeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return cleaned;
}

/** Pick the TV folder to download into: explicit setting first, then a root that looks like TV. */
export function pickDownloadRoot(roots: string[], env: Record<string, string | undefined> = process.env): string | null {
  const explicit = (env.YOUTUBE_DOWNLOAD_DIR || '').trim();
  if (explicit && path.isAbsolute(explicit)) return path.resolve(explicit);
  return roots.find((r) => /(^|[\\/])(tv|tv shows|shows|series|youtube)$/i.test(r)) ?? null;
}

/**
 * yt-dlp arguments (no shell is ever used). Files land as
 *   <root>/<Name>/Season YY/<Name> - SYYEMMDD - <title> [<id>].<ext>
 * so the local-media scanner reads them as episodes of one show, ordered by upload date.
 */
export function buildYtDlpArgs(opts: { root: string; name: string; url: string; maxVideos: number }): string[] {
  const folder = safeFolderName(opts.name);
  if (!folder) throw new Error('The name needs letters or numbers.');
  const showDir = path.join(opts.root, folder);
  const template = path.join(
    showDir,
    'Season %(upload_date>%y)s',
    `${folder} - S%(upload_date>%y)sE%(upload_date>%m%d)s - %(title).120B [%(id)s].%(ext)s`,
  );
  return [
    '--ignore-errors',
    '--no-warnings',
    '--no-progress',
    '--playlist-end', String(Math.max(1, Math.min(200, Math.floor(opts.maxVideos)))),
    '--download-archive', path.join(showDir, '.yt-archive.txt'),
    '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[height<=1080]/b',
    '--merge-output-format', 'mp4',
    '--windows-filenames',
    '--write-thumbnail',
    '--convert-thumbnails', 'jpg',
    '-o', template,
    '--',
    opts.url,
  ];
}
