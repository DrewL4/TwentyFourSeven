import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ORPCError, call } from '@orpc/server';

// Wish 17: YouTube sources. A fake yt-dlp stands in so no network or download happens.
const dir = mkdtempSync(path.join(tmpdir(), 'tfs-yt-'));
const tvRoot = path.join(dir, 'tv');
process.env.DATABASE_URL = `file:${path.join(dir, 't.db')}`;
let prisma: typeof import('../prisma').prisma;
let svc: typeof import('./service');
let routers: typeof import('../../routers/index');
const argsFile = path.join(dir, 'args.txt');
const okBin = path.join(dir, 'fake-ok.sh');
const failBin = path.join(dir, 'fake-fail.sh');

before(async () => {
  mkdirSync(tvRoot, { recursive: true });
  writeFileSync(okBin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nexit 0\n`);
  writeFileSync(failBin, `#!/bin/sh\necho 'ERROR: Video unavailable' >&2\nexit 2\n`);
  chmodSync(okBin, 0o755);
  chmodSync(failBin, 0o755);
  execFileSync('npx', ['prisma', 'db', 'push', '--schema', './prisma/schema', '--skip-generate'], {
    cwd: path.resolve(__dirname, '../../..'),
    env: process.env,
    stdio: 'ignore',
  });
  ({ prisma } = await import('../prisma'));
  svc = await import('./service');
  routers = await import('../../routers/index');
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    update: { localMediaPaths: tvRoot },
    create: { id: 'singleton', localMediaPaths: tvRoot },
  });
  await prisma.user.create({
    data: { id: 'adm', name: 'a', email: 'a@example.test', emailVerified: true, role: 'ADMIN', isActive: true, createdAt: new Date(), updatedAt: new Date() } as any,
  });
  await prisma.user.create({
    data: { id: 'mgr', name: 'm', email: 'm@example.test', emailVerified: true, role: 'MANAGER', isActive: true, createdAt: new Date(), updatedAt: new Date() } as any,
  });
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const ctx = (id: string) => ({ session: { user: { id } } as any, db: prisma, ip: '10.0.0.5', userAgent: 'test' });

describe('runYoutubeSource', () => {
  it('runs yt-dlp with safe args into the TV folder and records success', async () => {
    process.env.YTDLP_PATH = okBin;
    const s = await prisma.youtubeSource.create({ data: { name: 'NASA', url: 'https://www.youtube.com/@NASA', maxVideos: 3 } });
    const r = await svc.runYoutubeSource(s.id, { scan: false });
    assert.equal(r.ok, true);
    const args = readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.equal(args[args.length - 1], 'https://www.youtube.com/@NASA');
    assert.equal(args[args.length - 2], '--');
    assert.ok(args.some((a) => a.startsWith(path.join(tvRoot, 'NASA'))));
    const row = await prisma.youtubeSource.findUnique({ where: { id: s.id } });
    assert.equal(row?.lastStatus, 'ok');
    assert.equal(row?.lastError, null);
  });
  it('records yt-dlp failures and a missing binary in plain words', async () => {
    const s = await prisma.youtubeSource.create({ data: { name: 'Bad', url: 'https://youtu.be/xxxxx' } });
    process.env.YTDLP_PATH = failBin;
    const r = await svc.runYoutubeSource(s.id, { scan: false });
    assert.equal(r.ok, false);
    assert.match(r.error!, /Video unavailable/);
    process.env.YTDLP_PATH = path.join(dir, 'nope');
    const r2 = await svc.runYoutubeSource(s.id, { scan: false });
    assert.match(r2.error!, /not installed/);
  });
  it('creates missing parent folders when it can', () => {
    const deep = path.join(dir, 'deep', 'er');
    assert.equal(svc.prepareShowFolder(deep, 'Show'), null);
    assert.ok(statSync(path.join(deep, 'Show')).isDirectory());
  });
  it('explains an unwritable or missing media folder in plain words', () => {
    // Node reports a recursive mkdir on a read-only mount as ENOENT, so that is what the fake throws.
    const enoent = () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, mkdir '/tv/Blender Studio'"), { code: 'ENOENT' });
    };
    const msg = svc.prepareShowFolder('/tv', 'Blender Studio', false, enoent);
    assert.equal(msg, "TwentyFourSeven can't write to your TV folder (/tv). Check the folder mapping in your container settings.");
    assert.doesNotMatch(msg!, /ENOENT|mkdir/);
    assert.match(svc.prepareShowFolder('/youtube', 'X', true, enoent)!, /YouTube download folder \(\/youtube\)/);
  });
  it('stores a plain message, not a raw error, when the show folder cannot be created', async () => {
    const blocker = path.join(dir, 'a-file');
    writeFileSync(blocker, 'x');
    const saved = process.env.YOUTUBE_DOWNLOAD_DIR;
    process.env.YOUTUBE_DOWNLOAD_DIR = blocker;
    try {
      process.env.YTDLP_PATH = okBin;
      const s = await prisma.youtubeSource.create({ data: { name: 'Blender Studio', url: 'https://www.youtube.com/@BlenderStudio' } });
      const r = await svc.runYoutubeSource(s.id, { scan: false });
      assert.equal(r.ok, false);
      assert.match(r.error!, /could not create the download folder/);
      assert.doesNotMatch(r.error!, /mkdir|no such file/);
    } finally {
      if (saved === undefined) delete process.env.YOUTUBE_DOWNLOAD_DIR;
      else process.env.YOUTUBE_DOWNLOAD_DIR = saved;
    }
  });
  it('refuses a saved address that has no channel in it', async () => {
    const s = await prisma.youtubeSource.create({ data: { name: 'Truncated', url: 'https://www.youtube.com/' } });
    const r = await svc.runYoutubeSource(s.id, { scan: false });
    assert.equal(r.ok, false);
    assert.match(r.error!, /does not point to a channel/);
  });
  it('refuses a non-YouTube address stored in the database', async () => {
    const s = await prisma.youtubeSource.create({ data: { name: 'Evil', url: 'https://evil.example/x' } });
    const r = await svc.runYoutubeSource(s.id, { scan: false });
    assert.equal(r.ok, false);
    assert.match(r.error!, /YouTube/);
  });
});

describe('youtube router', () => {
  const r = () => (routers as any).appRouter.youtube;
  it('is Admin only', async () => {
    await assert.rejects(call(r().list, undefined, { context: ctx('mgr') }), (e) => e instanceof ORPCError && e.code === 'FORBIDDEN');
    assert.ok(Array.isArray(await call(r().list, undefined, { context: ctx('adm') })));
  });
  it('validates the address and the name', async () => {
    await assert.rejects(call(r().create, { name: 'X', url: 'http://youtube.com/x' }, { context: ctx('adm') }), /https/);
    await assert.rejects(call(r().create, { name: 'Home', url: 'https://www.youtube.com/' }, { context: ctx('adm') }), /does not point to a channel/);
    await assert.rejects(call(r().update, { id: 'x', url: 'https://www.youtube.com/' }, { context: ctx('adm') }), /does not point to a channel|not found|Not found/i);
    await assert.rejects(call(r().create, { name: '..', url: 'https://youtu.be/xxxxx' }, { context: ctx('adm') }), /letters or numbers/);
    const made: any = await call(r().create, { name: 'Kurzgesagt', url: 'https://www.youtube.com/@kurzgesagt', maxVideos: 5 }, { context: ctx('adm') });
    assert.equal(made.name, 'Kurzgesagt');
    await assert.rejects(call(r().create, { name: 'Kurzgesagt', url: 'https://youtu.be/xxxxx' }, { context: ctx('adm') }), /already exists/);
  });
  it('makes a channel only once the show is in the library', async () => {
    const src = await prisma.youtubeSource.findFirstOrThrow({ where: { name: 'Kurzgesagt' } });
    await assert.rejects(call(r().createChannel, { id: src.id }, { context: ctx('adm') }), /not in the library yet/);
    const server = await prisma.mediaServer.create({ data: { name: 'Local', url: 'local://files' } });
    const lib = await prisma.mediaLibrary.create({ data: { name: 'tv', serverId: server.id, type: 'SHOW', key: 'k' } });
    const show = await prisma.mediaShow.create({ data: { title: 'Kurzgesagt', ratingKey: 'k1', libraryId: lib.id } });
    const made: any = await call(r().createChannel, { id: src.id }, { context: ctx('adm') });
    assert.equal(made.number, 200);
    assert.equal(await prisma.channelShow.count({ where: { channelId: made.channelId, showId: show.id } }), 1);
  });
});
