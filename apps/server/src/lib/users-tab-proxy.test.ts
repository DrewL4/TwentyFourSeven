import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { callUsersTab, isUsersTabAction, USERS_TAB_ACTIONS } from './users-tab-proxy';
import { buildAppLoginEvent, reportAppLogin } from './app-login-report';
import { postSignedCall, signBody } from './wt-signed-post';

const link = { url: 'http://wt.local/', secret: 'shared-secret' };
const fixed = { now: () => new Date('2026-10-28T20:00:00Z'), nonce: () => 'n0nce' };

describe('callUsersTab', () => {
  it('signs a call that names the signed-in person as the actor', async () => {
    let seen: any;
    const r = await callUsersTab({ watchTowerUserId: '42' }, 'set_role', { user_id: 7, role: 'manager' }, {
      link: async () => link,
      post: async (_l, p) => {
        seen = p;
        return { status: 200, body: { ok: true } };
      },
      ...fixed,
    });
    assert.deepEqual(r, { status: 200, body: { ok: true } });
    assert.deepEqual(seen, {
      event_type: 'users_tab',
      timestamp: '2026-10-28T20:00:00.000Z',
      nonce: 'n0nce',
      actor_id: 42,
      action: 'set_role',
      args: { user_id: 7, role: 'manager' },
    });
  });

  it('a person without a WatchTower id is refused and WatchTower is never asked', async () => {
    let asked = 0;
    for (const id of [null, undefined, '', 'abc']) {
      const r = await callUsersTab({ watchTowerUserId: id }, 'list', {}, {
        link: async () => link,
        post: async () => (asked++, { status: 200, body: {} }),
      });
      assert.equal(r.status, 403);
    }
    assert.equal(asked, 0);
  });

  it('503 when 24/7 is not linked to WatchTower, and when reading the link fails', async () => {
    assert.equal((await callUsersTab({ watchTowerUserId: '1' }, 'list', {}, { link: async () => null })).status, 503);
    assert.equal(
      (await callUsersTab({ watchTowerUserId: '1' }, 'list', {}, { link: async () => { throw new Error('db'); } })).status,
      503,
    );
  });

  it('relays a WatchTower refusal (a Manager trying to edit) untouched', async () => {
    const r = await callUsersTab({ watchTowerUserId: '5' }, 'edit_basic', { user_id: 7 }, {
      link: async () => link,
      post: async () => ({ status: 403, body: { error: 'Not allowed.' } }),
    });
    assert.deepEqual(r, { status: 403, body: { error: 'Not allowed.' } });
  });

  it('only the six known actions are allowed through', () => {
    assert.deepEqual([...USERS_TAB_ACTIONS], ['set_role', 'approve', 'deny', 'edit_basic', 'set_app_access', 'remove_playlist']);
    for (const a of USERS_TAB_ACTIONS) assert.equal(isUsersTabAction(a), true);
    for (const a of ['list', 'delete_user', '', null, 3, undefined]) assert.equal(isUsersTabAction(a), false);
  });
});

describe('postSignedCall', () => {
  it('sends the HMAC of the exact body and returns status and JSON', async () => {
    let sent: { url: string; body: string; sig: string } | undefined;
    const fetchImpl = (async (url: string, init: any) => {
      sent = { url, body: init.body, sig: init.headers['X-Webhook-Signature'] };
      return new Response(JSON.stringify({ users: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;
    const r = await postSignedCall(link, { a: 1 }, { fetch: fetchImpl });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { users: [] });
    assert.ok(sent);
    assert.equal(sent!.sig, `sha256=${createHmac('sha256', 'shared-secret').update(sent!.body).digest('hex')}`);
    assert.equal(sent!.sig, signBody('shared-secret', sent!.body));
    assert.equal(sent!.url, 'http://wt.local/api/webhooks/twentyfourseven/');
  });

  it('a network failure becomes a 502 with a plain message', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as any;
    const r = await postSignedCall(link, {}, { fetch: fetchImpl });
    assert.equal(r.status, 502);
    assert.match(String((r.body as any).error), /Could not reach WatchTower/);
  });
});

describe('app.login report', () => {
  it('builds the event from the WatchTower id and e-mail', () => {
    assert.deepEqual(buildAppLoginEvent({ watchTowerUserId: '42', email: ' A@B.com ' }, new Date('2026-10-28T20:00:00Z')), {
      event_type: 'app.login',
      occurred_at: '2026-10-28T20:00:00.000Z',
      watchtower_user_id: 42,
      user_email: 'a@b.com',
    });
    assert.equal(buildAppLoginEvent({}, new Date()), null);
  });

  it('never throws and never blocks a sign-in when WatchTower is down', async () => {
    const down = await reportAppLogin({ watchTowerUserId: '1' }, { link: async () => link, post: async () => { throw new Error('boom'); } });
    assert.equal(down, false);
    const unlinked = await reportAppLogin({ watchTowerUserId: '1' }, { link: async () => null });
    assert.equal(unlinked, false);
    const ok = await reportAppLogin({ watchTowerUserId: '1' }, { link: async () => link, post: async () => ({ ok: true }) });
    assert.equal(ok, true);
  });
});
