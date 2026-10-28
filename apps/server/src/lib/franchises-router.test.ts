import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ORPCError, call } from '@orpc/server';

// Franchises for everyone: any user creates one from the library, everyone sees it, only its
// owner or a Manager changes it, and missing titles go to WatchTower as the user's own request.
const dir = mkdtempSync(path.join(tmpdir(), 'tfs-fr-'));
process.env.DATABASE_URL = `file:${path.join(dir, 't.db')}`;
process.env.BETTER_AUTH_SECRET = 'test-secret-for-franchise-router';
let prisma: typeof import('./prisma').prisma;
let routers: typeof import('../routers/index');
let seal: typeof import('./wt-user-token').sealWatchTowerToken;
let wt: Server;
let wtUrl = '';
const wtCalls: Array<{ auth: string | undefined; body: any }> = [];
const lookupCalls: Array<{ auth: string | undefined; body: any }> = [];
// What the fake WatchTower says about a tmdb id when asked (movie type); `lookupMode` can make it misbehave.
const wtKnown = new Map<number, { status: string; byMe: boolean }>();
let lookupMode: 'ok' | 'old' | 'down' = 'ok';

before(async () => {
  execFileSync('npx', ['prisma', 'db', 'push', '--schema', './prisma/schema', '--skip-generate'], {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'ignore',
  });
  ({ prisma } = await import('./prisma'));
  routers = await import('../routers/index');
  ({ sealWatchTowerToken: seal } = await import('./wt-user-token'));
  wt = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (req.url?.endsWith('/api/requests/lookup/')) {
        lookupCalls.push({ auth: req.headers.authorization, body });
        if (lookupMode !== 'ok') {
          res.writeHead(lookupMode === 'old' ? 404 : 500);
          return res.end('{}');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            results: body.items.map((it: any) => {
              const k = wtKnown.get(it.tmdb_id);
              return { tmdb_id: it.tmdb_id, media_type: it.media_type, requested: !!k, status: k?.status ?? null, requested_by_me: k?.byMe ?? false, earliest_release_date: null, theatrical_release_date: null };
            }),
          }),
        );
      }
      wtCalls.push({ auth: req.headers.authorization, body });
      const dup = body.tmdb_id === 999;
      res.writeHead(dup ? 409 : 201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dup ? { error: 'already requested', existing_request_id: 5, existing_status: 'downloading' } : { id: 41, status: 'pending', message: 'ok' }));
    });
  });
  await new Promise<void>((r) => wt.listen(0, '127.0.0.1', () => r()));
  wtUrl = `http://127.0.0.1:${(wt.address() as any).port}`;
  await prisma.setting.upsert({ where: { key: 'watchtower_url' }, update: { value: wtUrl }, create: { key: 'watchtower_url', value: wtUrl } });
});

after(async () => {
  await new Promise((r) => wt?.close(r));
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function seed(id: string, role: string, extra: Record<string, unknown> = {}) {
  await prisma.user.upsert({
    where: { id },
    update: { role, isActive: true, ...extra },
    create: { id, name: `User ${id}`, email: `${id}@example.test`, emailVerified: true, role, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...extra } as any,
  });
}
const ctx = (id: string) => ({ session: { user: { id } } as any, db: prisma, ip: '10.0.0.5', userAgent: 'test' });
const fr = () => (routers as any).appRouter.franchises;
const forbidden = (e: unknown) => e instanceof ORPCError && e.code === 'FORBIDDEN';

beforeEach(async () => {
  wtCalls.length = 0;
  lookupCalls.length = 0;
  wtKnown.clear();
  lookupMode = 'ok';
  (await import('./wt-status')).clearWtStatusCache();
  await seed('mgr', 'MANAGER');
  await seed('ann', 'USER');
  await seed('bob', 'USER', { watchTowerToken: seal('bob-wt-token') });
  await prisma.franchiseEntry.deleteMany();
  await prisma.franchise.deleteMany();
  await prisma.mediaMovie.deleteMany();
});

async function movie(title: string, year: number, tmdbId: number) {
  const lib =
    (await prisma.mediaLibrary.findFirst()) ??
    (await prisma.mediaLibrary.create({
      data: {
        key: '1',
        name: 'Movies',
        type: 'MOVIE',
        server: { create: { name: 'P', url: 'http://plex', type: 'PLEX' } },
      },
    }));
  return prisma.mediaMovie.create({
    data: { libraryId: lib.id, title, year, tmdbId, ratingKey: `rk${tmdbId}`, duration: 7_200_000 },
  });
}

async function make(userId: string, name = 'Avengers Test') {
  const a = await movie('Iron Man', 2008, 1726);
  const b = await movie('The Avengers', 2012, 24428);
  return call(fr().create, { name, libraryMovieIds: [b.id, a.id], sortMode: 'RELEASE' }, { context: ctx(userId) }) as Promise<any>;
}

describe('franchises: any user creates from the library, everyone sees it', () => {
  it('creates a movies-only franchise in release order, owned by the creator', async () => {
    const created = await make('ann');
    assert.equal(created.ownerId, 'ann');
    assert.equal(created.includeShows, false);
    assert.deepEqual(created.entries.map((e: any) => e.label), ['Iron Man', 'The Avengers']);
    assert.ok(created.entries.every((e: any) => e.available && e.kind === 'MOVIE'));
    const seen: any[] = await call(fr().list, undefined, { context: ctx('bob') });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].canEdit, false);
    const mine: any[] = await call(fr().list, undefined, { context: ctx('ann') });
    assert.equal(mine[0].canEdit, true);
  });

  it('only the owner or a Manager can change or delete it', async () => {
    const created = await make('ann');
    await assert.rejects(call(fr().update, { id: created.id, name: 'Mine now' }, { context: ctx('bob') }), forbidden);
    await assert.rejects(call(fr().delete, { id: created.id }, { context: ctx('bob') }), forbidden);
    const renamed: any = await call(fr().update, { id: created.id, name: 'Renamed' }, { context: ctx('ann') });
    assert.equal(renamed.name, 'Renamed');
    await call(fr().update, { id: created.id, description: 'by manager' }, { context: ctx('mgr') });
    await call(fr().delete, { id: created.id }, { context: ctx('ann') });
    assert.equal(await prisma.franchise.count(), 0);
  });

  it('keeps channel creation for Managers', async () => {
    const created = await make('ann');
    await assert.rejects(call(fr().createChannel, { franchiseId: created.id }, { context: ctx('ann') }), forbidden);
  });
});

describe('franchises: order and hand edits', () => {
  it('switching the order mode re-sorts and drops a hand order; moving saves one', async () => {
    const created = await make('ann');
    const first = created.entries[0].id;
    const moved: any = await call(fr().moveEntry, { entryId: first, direction: 'down' }, { context: ctx('ann') });
    assert.deepEqual(moved.entries.map((e: any) => e.label), ['The Avengers', 'Iron Man']);
    assert.equal(moved.customOrder, true);
    const back: any = await call(fr().update, { id: created.id, sortMode: 'RECOMMENDED' }, { context: ctx('ann') });
    assert.equal(back.customOrder, false);
    assert.deepEqual(back.entries.map((e: any) => e.label), ['Iron Man', 'The Avengers']);
  });

  it('removing a hand-added entry deletes it; removing a synced one hides it and can be undone', async () => {
    const created = await make('ann');
    const manual = created.entries[0];
    const after: any = await call(fr().removeEntry, { entryId: manual.id }, { context: ctx('ann') });
    assert.equal(after.entries.length, 1);
    await prisma.franchiseEntry.update({ where: { id: after.entries[0].id }, data: { manual: false } });
    const hidden: any = await call(fr().removeEntry, { entryId: after.entries[0].id }, { context: ctx('ann') });
    assert.equal(hidden.entries[0].excluded, true);
    assert.equal(hidden.entryCount, 0);
    const restored: any = await call(fr().restoreEntry, { entryId: hidden.entries[0].id }, { context: ctx('ann') });
    assert.equal(restored.entries[0].excluded, false);
  });

  it('TV entries need Include TV shows, and it is off by default', async () => {
    const created = await make('ann');
    await assert.rejects(
      call(fr().addEntry, { franchiseId: created.id, kind: 'SEASON', title: 'Loki', tmdbId: 84958, seasonNumber: 1 }, { context: ctx('ann') }),
      /Include TV shows/,
    );
    await call(fr().update, { id: created.id, includeShows: true }, { context: ctx('ann') });
    const withSeason: any = await call(
      fr().addEntry,
      { franchiseId: created.id, kind: 'SEASON', title: 'Loki', tmdbId: 84958, seasonNumber: 1, releaseDate: '2021-06-09' },
      { context: ctx('ann') },
    );
    const season = withSeason.entries.find((e: any) => e.kind === 'SEASON');
    assert.equal(season.label, 'Loki - Season 1');
    assert.equal(season.available, false);
    assert.equal(season.manual, true);
  });
});

describe('franchises.requestMissing', () => {
  async function withMissing() {
    const created = await make('bob');
    await call(fr().update, { id: created.id, includeShows: true }, { context: ctx('bob') });
    await call(fr().addEntry, { franchiseId: created.id, kind: 'MOVIE', title: 'Thor', tmdbId: 10195, releaseDate: '2011-05-06' }, { context: ctx('bob') });
    return (await call(fr().get, { id: created.id }, { context: ctx('bob') })) as any;
  }

  it('sends each missing title to WatchTower with the user own token, then marks it requested', async () => {
    const detail = await withMissing();
    assert.equal(detail.missingCount, 1);
    const out: any = await call(fr().requestMissing, { franchiseId: detail.id }, { context: ctx('bob') });
    assert.equal(out.requested, 1);
    assert.equal(wtCalls.length, 1);
    assert.equal(wtCalls[0].auth, 'Token bob-wt-token');
    assert.deepEqual(wtCalls[0].body, { title: 'Thor', media_type: 'movie', tmdb_id: 10195 });
    const after: any = await call(fr().get, { id: detail.id }, { context: ctx('bob') });
    const thor = after.entries.find((e: any) => e.label === 'Thor');
    assert.ok(thor.requestedAt);
    assert.equal(thor.wtRequestId, 41);
  });

  it('reports an already-requested title without failing the call', async () => {
    const detail = await withMissing();
    const thor = detail.entries.find((e: any) => e.label === 'Thor');
    await prisma.franchiseEntry.update({ where: { id: thor.id }, data: { tmdbId: 999 } });
    const out: any = await call(fr().requestMissing, { franchiseId: detail.id }, { context: ctx('bob') });
    assert.equal(out.alreadyRequested, 1);
    assert.equal(out.failed, 0);
  });

  it('asks a user with no stored WatchTower sign-in to sign in again, and sends nothing', async () => {
    const created = await make('ann');
    await call(fr().addEntry, { franchiseId: created.id, kind: 'MOVIE', title: 'Thor', tmdbId: 10195 }, { context: ctx('ann') });
    await assert.rejects(
      call(fr().requestMissing, { franchiseId: created.id }, { context: ctx('ann') }),
      /sign out of 24\/7 and sign in again/,
    );
    assert.equal(wtCalls.length, 0);
  });

  it('can request items from an unsaved preview, and says so when TMDB has no id for one', async () => {
    const out: any = await call(
      fr().requestMissing,
      { items: [{ kind: 'MOVIE', label: 'Thor', tmdbId: 10195 }, { kind: 'MOVIE', label: 'Unknown', tmdbId: null }] },
      { context: ctx('bob') },
    );
    assert.equal(out.requested, 1);
    assert.equal(out.failed, 1);
    assert.equal(wtCalls.length, 1);
  });

  it('lists a title that is in the library twice once, and adds it to a franchise once', async () => {
    const withId = await movie('Elephants Dream', 2006, 4001);
    const lib = await prisma.mediaLibrary.findFirstOrThrow();
    const noId = await prisma.mediaMovie.create({
      data: { libraryId: lib.id, title: 'Elephants Dream', year: 2006, tmdbId: null, ratingKey: 'rk-local', duration: 600_000 },
    });
    const found: any = await call(fr().searchLibrary, { query: 'Elephants' }, { context: ctx('ann') });
    assert.equal(found.movies.length, 1);
    assert.equal(found.movies[0].id, withId.id);
    const created: any = await call(
      fr().create,
      { name: 'Dupes', libraryMovieIds: [noId.id, withId.id], sortMode: 'RELEASE' },
      { context: ctx('ann') },
    );
    assert.equal(created.entries.length, 1);
    const again: any = await call(
      fr().addEntry,
      { franchiseId: created.id, kind: 'MOVIE', libraryMovieId: withId.id },
      { context: ctx('ann') },
    );
    assert.equal(again.entries.length, 1);
  });

  it('keeps remakes with the same title but a different year as separate entries', async () => {
    const a = await movie('Total Recall', 1990, 861);
    const b = await movie('Total Recall', 2012, 64635);
    const created: any = await call(fr().create, { name: 'Recall', libraryMovieIds: [a.id, b.id], sortMode: 'RELEASE' }, { context: ctx('ann') });
    assert.equal(created.entries.length, 2);
  });

  it('explains an unresolved title when TMDB is not set up', async () => {
    const out: any = await call(
      fr().requestMissing,
      { items: [{ kind: 'MOVIE', label: 'Unknown', tmdbId: null }] },
      { context: ctx('bob') },
    );
    assert.match(out.results[0].outcome.message, /TMDB/);
  });
});

describe('franchises.requestInfo', () => {
  const thor = { key: 'k-thor', kind: 'MOVIE', tmdbId: 10195, releaseDate: '2011-05-06' };
  const loki = { key: 'k-loki', kind: 'SHOW', tmdbId: 84958, releaseDate: null };
  const info = (user: string, items: any[]) => call(fr().requestInfo, { items }, { context: ctx(user) }) as Promise<any>;
  const byKey = (out: any, key: string) => out.items.find((i: any) => i.key === key);

  it('shows the real WatchTower status for each title in one call, as the signed-in user', async () => {
    wtKnown.set(10195, { status: 'pending', byMe: false });
    wtKnown.set(84958, { status: 'available', byMe: true });
    const out = await info('bob', [thor, loki, { key: 'k-none', kind: 'MOVIE', tmdbId: 1, releaseDate: null }]);
    assert.equal(lookupCalls.length, 1);
    assert.equal(lookupCalls[0].auth, 'Token bob-wt-token');
    assert.equal(lookupCalls[0].body.items.length, 3);
    assert.equal(out.watchtower.ok, true);
    assert.deepEqual(byKey(out, 'k-thor').wt, { state: 'pending', requestedByMe: false });
    assert.deepEqual(byKey(out, 'k-loki').wt, { state: 'available', requestedByMe: true });
    assert.equal(byKey(out, 'k-none').wt, null);
    assert.ok(!JSON.stringify(out).match(/username|requested_by"|"user"/));
  });

  it('flips a row to the real status after it is requested, and does not reuse a stale answer', async () => {
    assert.equal(byKey(await info('bob', [thor]), 'k-thor').wt, null);
    const out: any = await call(fr().requestMissing, { items: [{ key: 'k-thor', kind: 'MOVIE', label: 'Thor', tmdbId: 10195 }] }, { context: ctx('bob') });
    assert.equal(out.results[0].key, 'k-thor');
    wtKnown.set(10195, { status: 'approved', byMe: true });
    assert.deepEqual(byKey(await info('bob', [thor]), 'k-thor').wt, { state: 'approved', requestedByMe: true });
  });

  it('hands back the status WatchTower already has for a duplicate request', async () => {
    const out: any = await call(fr().requestMissing, { items: [{ key: 'k-dup', kind: 'MOVIE', label: 'Dup', tmdbId: 999 }] }, { context: ctx('bob') });
    assert.equal(out.results[0].outcome.status, 'duplicate');
    assert.equal(out.results[0].outcome.wtStatus, 'downloading');
  });

  it('still answers when WatchTower is down, old, or the user has no sign-in', async () => {
    lookupMode = 'down';
    let out = await info('bob', [thor]);
    assert.equal(out.watchtower.ok, false);
    assert.equal(out.watchtower.reason, 'unreachable');
    assert.equal(byKey(out, 'k-thor').wt, null);
    lookupMode = 'old';
    (await import('./wt-status')).clearWtStatusCache();
    out = await info('bob', [thor]);
    assert.equal(out.watchtower.reason, 'unsupported');
    out = await info('ann', [thor]);
    assert.equal(out.watchtower.reason, 'no-token');
    assert.equal(lookupCalls.length, 2);
  });

  it('turns an episode range and a season into a season lookup, and skips titles with no TMDB id', async () => {
    await info('bob', [
      { key: 'a', kind: 'SEASON', tmdbId: 5, seasonNumber: 2, releaseDate: null },
      { key: 'b', kind: 'EPISODES', tmdbId: 6, seasonNumber: 1, releaseDate: null },
      { key: 'c', kind: 'MOVIE', tmdbId: null, releaseDate: null },
    ]);
    assert.deepEqual(lookupCalls[0].body.items, [
      { tmdb_id: 5, media_type: 'season', season_number: 2 },
      { tmdb_id: 6, media_type: 'season', season_number: 1 },
    ]);
  });
});
