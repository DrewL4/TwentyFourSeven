import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { prisma } from '../prisma';
import { configuredLocalRoots } from '../local-media/paths';
import { buildYtDlpArgs, parseYoutubeUrl, pickDownloadRoot, safeFolderName, usesExplicitDownloadDir } from './plan';

const RUN_TIMEOUT_MS = 60 * 60 * 1000;
const running = new Set<string>();

export type RunResult = { ok: boolean; status: string; error?: string };

export function ytDlpBinary(env: Record<string, string | undefined> = process.env): string {
  return (env.YTDLP_PATH || '').trim() || 'yt-dlp';
}

function runProcess(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string; missing: boolean }> {
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: e.message, missing: e.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, missing: false });
    });
  });
}

/**
 * Create the show folder (and any missing parents) and check we can write into it.
 * A read-only or missing media mapping is reported in plain words, never as a raw ENOENT.
 */
export function prepareShowFolder(root: string, folder: string, explicitDir = false, mkdir: (p: string) => void = (p) => void mkdirSync(p, { recursive: true })): string | null {
  const showDir = `${root}/${folder}`;
  try {
    mkdir(showDir);
    accessSync(showDir, constants.W_OK);
    return null;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
      return explicitDir
        ? `TwentyFourSeven can't write to the YouTube download folder (${root}). Check that the folder is mapped to your container and is not read-only.`
        : `TwentyFourSeven can't write to your TV folder (${root}). Check the folder mapping in your container settings.`;
    }
    return `TwentyFourSeven could not create the download folder inside ${root}${code ? ` (${code})` : ''}.`;
  }
}

/** Download the newest videos of one source, then refresh the local library. */
export async function runYoutubeSource(id: string, opts: { timeoutMs?: number; scan?: boolean } = {}): Promise<RunResult> {
  const source = await prisma.youtubeSource.findUnique({ where: { id } });
  if (!source) return { ok: false, status: 'missing', error: 'Source not found' };
  if (running.has(id)) return { ok: false, status: 'busy', error: 'Already running' };
  running.add(id);
  const finish = async (result: RunResult): Promise<RunResult> => {
    await prisma.youtubeSource.update({
      where: { id },
      data: { lastRunAt: new Date(), lastStatus: result.status, lastError: result.error ?? null },
    });
    return result;
  };
  try {
    const parsed = parseYoutubeUrl(source.url);
    if (!parsed.ok) return await finish({ ok: false, status: 'failed', error: parsed.reason });
    const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    const root = pickDownloadRoot(configuredLocalRoots(settings?.localMediaPaths));
    if (!root) {
      return await finish({
        ok: false,
        status: 'failed',
        error: 'No TV folder to download into. Add a TV folder in Settings > Local media, or set YOUTUBE_DOWNLOAD_DIR.',
      });
    }
    let args: string[];
    try {
      args = buildYtDlpArgs({ root, name: source.name, url: parsed.url, maxVideos: source.maxVideos });
    } catch (e) {
      return await finish({ ok: false, status: 'failed', error: (e as Error).message });
    }
    const folderProblem = prepareShowFolder(root, safeFolderName(source.name), usesExplicitDownloadDir());
    if (folderProblem) return await finish({ ok: false, status: 'failed', error: folderProblem });
    const out = await runProcess(ytDlpBinary(), args, opts.timeoutMs ?? RUN_TIMEOUT_MS);
    if (out.missing) {
      return await finish({ ok: false, status: 'failed', error: 'yt-dlp is not installed on this server (set YTDLP_PATH or use the updated image).' });
    }
    // --ignore-errors lets a few unavailable videos fail without losing the rest.
    const result: RunResult = out.code === 0 || out.code === 1
      ? { ok: true, status: out.code === 0 ? 'ok' : 'ok-with-skips' }
      : { ok: false, status: 'failed', error: out.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300) || `yt-dlp exited ${out.code}` };
    if (result.ok && opts.scan !== false) {
      const { scanLocalMedia } = await import('../local-media/scanner');
      void scanLocalMedia();
    }
    return await finish(result);
  } finally {
    running.delete(id);
  }
}

let timer: NodeJS.Timeout | null = null;

/** Check all enabled sources every YOUTUBE_CHECK_HOURS (default 6), one at a time. */
export function startYoutubeScheduler(): void {
  if (timer) return;
  const hours = Math.max(1, Number(process.env.YOUTUBE_CHECK_HOURS) || 6);
  const sweep = async () => {
    try {
      const sources = await prisma.youtubeSource.findMany({ where: { enabled: true } });
      for (const s of sources) await runYoutubeSource(s.id);
    } catch (e) {
      console.error('[YouTube] sweep failed:', (e as Error).message);
    }
  };
  timer = setInterval(() => void sweep(), hours * 3_600_000);
  timer.unref?.();
}
