import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  clearWtStatusCache,
  forgetUserWtStatuses,
  lookupWtStatuses,
  wtItemKey,
  wtStateFrom,
  wtStatusCacheSize,
} from './wt-status';

const movie = (tmdbId: number) => ({ mediaType: 'movie' as const, tmdbId });
const row = (over: Record<string, unknown> = {}) => ({
  requested: false,
  status: null,
  requested_by_me: false,
  earliest_release_date: null,
  theatrical_release_date: null,
  ...over,
});

function fakeWt(rows: (body: { items: Array<Record<string, unknown>> }) => unknown[], status = 200) {
  const calls: Array<{ url: string; auth: string; body: { items: Array<Record<string, unknown>> } }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, auth: (init.headers as Record<string, string>).Authorization, body });
    return new Response(JSON.stringify({ results: rows(body) }), { status });
  };
  return { calls, fetchImpl };
}

const base = { baseUrl: 'http://wt.local/', userId: 'u1', userToken: 'tok' };

describe('lookupWtStatuses', () => {
  beforeEach(() => clearWtStatusCache());

  it('asks WatchTower once for the whole list with the user token, and maps each answer', async () => {
    const wt = fakeWt((b) =>
      b.items.map((it) =>
        it.tmdb_id === 1 ? row({ requested: true, status: 'pending', requested_by_me: true }) : it.tmdb_id === 2 ? row({ requested: true, status: 'downloading' }) : row(),
      ),
    );
    const out = await lookupWtStatuses({ ...base, items: [movie(1), movie(2), movie(3), { mediaType: 'season', tmdbId: 9, seasonNumber: 2 }] }, wt.fetchImpl);
    assert.equal(wt.calls.length, 1);
    assert.equal(wt.calls[0].url, 'http://wt.local/api/requests/lookup/');
    assert.equal(wt.calls[0].auth, 'Token tok');
    assert.deepEqual(wt.calls[0].body.items[3], { tmdb_id: 9, media_type: 'season', season_number: 2 });
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.deepEqual(out.statuses.get(wtItemKey(movie(1)))?.state, 'pending');
    assert.equal(out.statuses.get(wtItemKey(movie(1)))?.requestedByMe, true);
    assert.equal(out.statuses.get(wtItemKey(movie(2)))?.state, 'downloading');
    assert.equal(out.statuses.get(wtItemKey(movie(2)))?.requestedByMe, false);
    assert.equal(out.statuses.get(wtItemKey(movie(3))), null);
  });

  it('never carries a name of another requester', async () => {
    const wt = fakeWt((b) => b.items.map(() => row({ requested: true, status: 'approved', requested_by: 'someone', username: 'bob' })));
    const out = await lookupWtStatuses({ ...base, items: [movie(1)] }, wt.fetchImpl);
    assert.ok(out.ok);
    if (out.ok) assert.deepEqual(Object.keys(out.statuses.get(wtItemKey(movie(1)))!).sort(), ['earliestDate', 'requestedByMe', 'state', 'theatricalDate']);
  });

  it('serves repeat views from the short cache, only asking for titles it has not seen', async () => {
    const wt = fakeWt((b) => b.items.map(() => row({ requested: true, status: 'approved' })));
    await lookupWtStatuses({ ...base, items: [movie(1), movie(2)] }, wt.fetchImpl);
    await lookupWtStatuses({ ...base, items: [movie(1), movie(2)] }, wt.fetchImpl);
    assert.equal(wt.calls.length, 1);
    await lookupWtStatuses({ ...base, items: [movie(2), movie(3)] }, wt.fetchImpl);
    assert.equal(wt.calls.length, 2);
    assert.deepEqual(wt.calls[1].body.items.map((i) => i.tmdb_id), [3]);
  });

  it('keeps each user separate and can forget one user after they request something', async () => {
    const wt = fakeWt((b) => b.items.map(() => row()));
    await lookupWtStatuses({ ...base, items: [movie(1)] }, wt.fetchImpl);
    await lookupWtStatuses({ ...base, userId: 'u2', items: [movie(1)] }, wt.fetchImpl);
    assert.equal(wt.calls.length, 2);
    forgetUserWtStatuses('u1');
    await lookupWtStatuses({ ...base, items: [movie(1)] }, wt.fetchImpl);
    assert.equal(wt.calls.length, 3);
    await lookupWtStatuses({ ...base, userId: 'u2', items: [movie(1)] }, wt.fetchImpl);
    assert.equal(wt.calls.length, 3);
  });

  it('splits more than 100 titles into batches and keeps the cache bounded', async () => {
    const wt = fakeWt((b) => b.items.map(() => row()));
    const items = Array.from({ length: 230 }, (_, i) => movie(i + 1));
    const out = await lookupWtStatuses({ ...base, items }, wt.fetchImpl);
    assert.ok(out.ok);
    assert.deepEqual(wt.calls.map((c) => c.body.items.length), [100, 100, 30]);
    assert.ok(wtStatusCacheSize() <= 1500);
  });

  it('fails soft: no token, no WatchTower url, down, refused, old', async () => {
    const wt = fakeWt(() => []);
    assert.deepEqual(
      [(await lookupWtStatuses({ ...base, userToken: null, items: [movie(1)] }, wt.fetchImpl)), (await lookupWtStatuses({ ...base, baseUrl: null, items: [movie(1)] }, wt.fetchImpl))].map((r) => !r.ok && r.reason),
      ['no-token', 'no-watchtower'],
    );
    assert.equal(wt.calls.length, 0);

    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    const r1 = await lookupWtStatuses({ ...base, items: [movie(1)] }, down);
    assert.ok(!r1.ok && r1.reason === 'unreachable');
    clearWtStatusCache();
    for (const [status, reason] of [[401, 'unauthorized'], [403, 'unauthorized'], [404, 'unsupported'], [405, 'unsupported'], [500, 'unreachable']] as const) {
      clearWtStatusCache();
      const r = await lookupWtStatuses({ ...base, items: [movie(1)] }, async () => new Response('{}', { status }));
      assert.ok(!r.ok && r.reason === reason, `${status}`);
    }
    clearWtStatusCache();
    const bad = await lookupWtStatuses({ ...base, items: [movie(1), movie(2)] }, async () => new Response(JSON.stringify({ results: [row()] }), { status: 200 }));
    assert.ok(!bad.ok);
  });

  it('does not hammer a WatchTower that just failed', async () => {
    let calls = 0;
    const down = async () => {
      calls++;
      throw new Error('down');
    };
    await lookupWtStatuses({ ...base, items: [movie(1)] }, down);
    await lookupWtStatuses({ ...base, items: [movie(2)] }, down);
    assert.equal(calls, 1);
  });

  it('maps WatchTower statuses, and anything unknown becomes a plain "requested"', () => {
    for (const s of ['pending', 'approved', 'downloading', 'available', 'denied', 'failed'] as const) assert.equal(wtStateFrom(s), s);
    assert.equal(wtStateFrom('weird'), 'requested');
    assert.equal(wtStateFrom(null), 'requested');
  });
});
