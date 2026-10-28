import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createNonceStore, handleUserPage, NONCE_TTL_MS,
  type PageData, type PageUser, type StreamLimit, type UserPageStore,
} from './user-page-door';
import { callUsersTab } from './users-tab-proxy';

const NOW = Date.parse('2026-10-28T20:00:00Z');
const USER: PageUser = { id: 'u1', email: 'sam@example.com' };

function fakeStore(over: Partial<StreamLimit> = {}) {
  const state = { limit: { has_login: true, max_streams: 2, username: 'sam', linked: false, editable: true, ...over } as StreamLimit, writes: [] as number[] };
  const store: UserPageStore = {
    async findUser({ wtId }) { return wtId === '7' ? USER : null; },
    async streamLimit() { return state.limit; },
    async setMaxStreams(_u, v) { state.writes.push(v); state.limit = { ...state.limit, max_streams: v }; },
    async read(): Promise<PageData> {
      return {
        user: { id: 'u1', email: USER.email, created_at: null, last_login: null },
        stream_limit: state.limit, franchises: [], recent_viewing: [],
      };
    },
  };
  return { store, state };
}

let counter = 0;
function call(action: string, deps: ReturnType<typeof fakeStore>, extra: Record<string, unknown> = {}, nonces = createNonceStore()) {
  return handleUserPage(
    { event_type: 'user_page', action, timestamp: new Date(NOW).toISOString(), nonce: `nonce-${++counter}-abcdef`, target_wt_id: 7,
      target_email: USER.email, caps: { edit: true }, args: { changes: {} }, ...extra },
    { store: deps.store, nonces, now: () => NOW },
  );
}

describe('user page door: permission matrix', () => {
  it('lets someone with edit rights read, validate and apply', async () => {
    const f = fakeStore();
    assert.equal((await call('get', f)).status, 200);
    const v = await call('validate', f, { args: { changes: { max_streams: 4 } } });
    assert.deepEqual(v, { status: 200, body: { changed: true } });
    assert.deepEqual(f.state.writes, [], 'validate never writes');
    assert.equal((await call('apply', f, { args: { changes: { max_streams: 4 } } })).status, 200);
    assert.deepEqual(f.state.writes, [4]);
  });

  it('lets a view-only person read but never validate or apply', async () => {
    const f = fakeStore();
    const read = await call('get', f, { caps: { edit: false } });
    assert.equal(read.status, 200);
    assert.deepEqual((read.body.data as any).rights, { edit: false });
    for (const action of ['validate', 'apply']) {
      const r = await call(action, f, { caps: { edit: false }, args: { changes: { max_streams: 5 } } });
      assert.equal(r.status, 403, action);
    }
    assert.deepEqual(f.state.writes, []);
  });

  it('treats missing or odd caps as view-only', async () => {
    const f = fakeStore();
    for (const caps of [undefined, {}, { edit: 'yes' }, 'edit']) {
      const r = await call('apply', f, { caps, args: { changes: { max_streams: 5 } } });
      assert.equal(r.status, 403);
    }
    assert.deepEqual(f.state.writes, []);
  });
});

describe('user page door: what may be changed', () => {
  it('takes only whole numbers from 0 to 50', async () => {
    const f = fakeStore();
    for (const bad of [-1, 51, 1.5, '3', null, true]) {
      const r = await call('validate', f, { args: { changes: { max_streams: bad } } });
      assert.equal(r.status, 422, String(bad));
      assert.ok((r.body.errors as any).max_streams);
    }
    for (const ok of [0, 50]) assert.equal((await call('validate', f, { args: { changes: { max_streams: ok } } })).status, 200);
  });

  it('refuses fields it does not own', async () => {
    const f = fakeStore();
    const r = await call('apply', f, { args: { changes: { max_streams: 3, role: 'admin' } } });
    assert.equal(r.status, 422);
    assert.ok((r.body.errors as any).role);
    assert.deepEqual(f.state.writes, [], 'nothing is written when any field is refused');
  });

  it('keeps the limit read-only while linked to ESPG', async () => {
    const f = fakeStore({ linked: true, editable: false, max_streams: null });
    const r = await call('apply', f, { args: { changes: { max_streams: 3 } } });
    assert.equal(r.status, 422);
    assert.match(String((r.body.errors as any).max_streams), /ESPG/);
    assert.deepEqual(f.state.writes, []);
  });

  it('needs a playlist login first', async () => {
    const f = fakeStore({ has_login: false, max_streams: null, username: null });
    const r = await call('apply', f, { args: { changes: { max_streams: 3 } } });
    assert.equal(r.status, 422);
  });

  it('reports unchanged when the number is the same', async () => {
    const f = fakeStore();
    assert.deepEqual((await call('validate', f, { args: { changes: { max_streams: 2 } } })).body, { changed: false });
  });
});

describe('user page door: freshness and people', () => {
  it('refuses an old or invalid timestamp', async () => {
    const f = fakeStore();
    for (const timestamp of [new Date(NOW - 301_000).toISOString(), new Date(NOW + 301_000).toISOString(), 'soon', undefined]) {
      assert.equal((await call('get', f, { timestamp })).status, 400);
    }
  });

  it('refuses a repeated nonce but takes a new one', async () => {
    const f = fakeStore();
    const nonces = createNonceStore();
    assert.equal((await call('get', f, { nonce: 'same-nonce-1' }, nonces)).status, 200);
    assert.equal((await call('get', f, { nonce: 'same-nonce-1' }, nonces)).status, 400);
    assert.equal((await call('get', f, { nonce: 'same-nonce-2' }, nonces)).status, 200);
  });

  it('forgets nonces after the window and stays bounded', () => {
    const nonces = createNonceStore(3);
    assert.equal(nonces.add('aaaaaaaa', 0), true);
    assert.equal(nonces.add('aaaaaaaa', 1), false);
    assert.equal(nonces.add('aaaaaaaa', NONCE_TTL_MS + 1), true);
    for (const n of ['b1', 'b2', 'b3', 'b4']) nonces.add(n, NONCE_TTL_MS + 2);
    assert.equal(nonces.add('b1', NONCE_TTL_MS + 3), true, 'the oldest was dropped to stay within the bound');
  });

  it('refuses an unknown action and a missing nonce', async () => {
    const f = fakeStore();
    assert.equal((await call('delete', f)).status, 400);
    assert.equal((await call('get', f, { nonce: '' })).status, 400);
  });

  it('says when the person has not signed in to 24/7', async () => {
    const f = fakeStore();
    const r = await call('get', f, { target_wt_id: 99 });
    assert.equal(r.status, 200);
    assert.equal(r.body.found, false);
    assert.equal((await call('apply', f, { target_wt_id: 99, args: { changes: { max_streams: 3 } } })).status, 404);
  });

  it('does not leak internal errors', async () => {
    const f = fakeStore();
    f.store.read = async () => { throw new Error('db password=hunter2'); };
    const r = await call('get', f);
    assert.equal(r.status, 500);
    assert.doesNotMatch(JSON.stringify(r.body), /hunter2/);
  });
});

describe('page calls to WatchTower', () => {
  const deps = (seen: any[]) => ({
    link: async () => ({ url: 'http://wt.local', secret: 's' }),
    post: async (_l: unknown, p: unknown) => { seen.push(p); return { status: 200, body: {} }; },
    now: () => new Date(NOW), nonce: () => 'n',
  });

  it('sends the page actions as the signed-in person', async () => {
    const seen: any[] = [];
    await callUsersTab({ watchTowerUserId: '42' }, 'user_page', { user_id: 7 }, deps(seen));
    await callUsersTab({ watchTowerUserId: '42' }, 'user_page_save', { user_id: 7, changes: { overview: {} } }, deps(seen));
    await callUsersTab({ watchTowerUserId: '42' }, 'remove_playlist', { user_id: 7, playlist_id: 3 }, deps(seen));
    assert.deepEqual(seen.map((p) => [p.action, p.actor_id]), [['user_page', 42], ['user_page_save', 42], ['remove_playlist', 42]]);
  });

  it('refuses a person with no WatchTower account', async () => {
    const r = await callUsersTab({ watchTowerUserId: null }, 'user_page', { user_id: 7 }, deps([]));
    assert.equal(r.status, 403);
  });
});
