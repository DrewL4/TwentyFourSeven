import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWtRequestBody, sendWtRequest, WT_NO_TOKEN_MESSAGE } from './wt-requests';

const item = { title: 'Thor', mediaType: 'movie' as const, tmdbId: 10195, posterPath: '/t.jpg' };
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe('sendWtRequest', () => {
  it('sends the user own token to WatchTower and never a user_id', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const out = await sendWtRequest({ baseUrl: 'http://wt.local/', userToken: 'tok123', item }, async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: 7, status: 'pending', message: 'ok' }), { status: 201 });
    });
    assert.equal(seen!.url, 'http://wt.local/api/requests/');
    assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Token tok123');
    const body = JSON.parse(String(seen!.init.body));
    assert.deepEqual(body, { title: 'Thor', media_type: 'movie', tmdb_id: 10195, poster_path: '/t.jpg' });
    assert.ok(!('user_id' in body));
    assert.deepEqual(out, { ok: true, status: 'requested', requestId: 7, wtStatus: 'pending', message: 'ok' });
  });

  it('passes through whatever approval status WatchTower decides', async () => {
    const out = await sendWtRequest({ baseUrl: 'http://wt', userToken: 't', item }, reply(201, { id: 1, status: 'approved' }));
    assert.equal(out.ok && out.wtStatus, 'approved');
  });

  it('reports a duplicate', async () => {
    const out = await sendWtRequest({ baseUrl: 'http://wt', userToken: 't', item }, reply(409, { error: 'already', existing_request_id: 3 }));
    assert.equal(out.status, 'duplicate');
    assert.equal(out.status === 'duplicate' && out.requestId, 3);
  });

  it('asks the user to sign in again when there is no token or WatchTower refuses it', async () => {
    const none = await sendWtRequest({ baseUrl: 'http://wt', userToken: null, item }, reply(201, {}));
    assert.equal(none.status, 'no-token');
    assert.equal(none.message, WT_NO_TOKEN_MESSAGE);
    assert.equal((await sendWtRequest({ baseUrl: 'http://wt', userToken: 't', item }, reply(401, {}))).status, 'unauthorized');
    assert.equal((await sendWtRequest({ baseUrl: 'http://wt', userToken: 't', item }, reply(403, {}))).status, 'unauthorized');
  });

  it('reports rejections and network errors', async () => {
    assert.equal((await sendWtRequest({ baseUrl: 'http://wt', userToken: 't', item }, reply(400, { error: 'bad' }))).status, 'rejected');
    const down = await sendWtRequest({ baseUrl: 'http://wt', userToken: 't', item }, async () => { throw new Error('ECONNREFUSED'); });
    assert.equal(down.status, 'unreachable');
  });
});

describe('buildWtRequestBody', () => {
  it('includes the season for season requests', () => {
    assert.deepEqual(buildWtRequestBody({ title: 'Loki', mediaType: 'season', tmdbId: 84958, seasonNumber: 2 }), {
      title: 'Loki', media_type: 'season', tmdb_id: 84958, season_number: 2,
    });
  });
});
