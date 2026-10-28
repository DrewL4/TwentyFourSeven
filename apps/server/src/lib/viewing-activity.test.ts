import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildViewingActivityEvent,
  createViewingActivityEmitter,
  FAILURE_BACKOFF_MS,
  THROTTLE_MS,
  throttleKey,
  type ViewingActivityEvent,
} from './viewing-activity';
import { postSignedEvent, signBody } from './wt-signed-post';

const link = { url: 'http://wt.local/', secret: 'shared-secret' };

function harness(result: { ok: boolean; error?: string } = { ok: true }) {
  let clock = 1_000_000;
  const posted: ViewingActivityEvent[] = [];
  const emitter = createViewingActivityEmitter({
    link: async () => link,
    post: async (_l, event) => {
      posted.push(event);
      return result;
    },
    now: () => clock,
  });
  return { emitter, posted, advance: (ms: number) => (clock += ms), set: (r: typeof result) => (result = r) };
}

describe('what was watched', () => {
  it('carries a trimmed, capped description of what they watched', () => {
    const e = buildViewingActivityEvent({ email: 'a@b.com', what: '  Channel 5 Movies - Alien  ' }, new Date('2026-10-27T20:00:00Z'));
    assert.equal(e?.what, 'Channel 5 Movies - Alien');
    assert.equal(buildViewingActivityEvent({ email: 'a@b.com', what: 'x'.repeat(500) }, new Date())?.what?.length, 200);
  });
  it('leaves the field out when there is nothing to say', () => {
    const e = buildViewingActivityEvent({ email: 'a@b.com', what: '  ' }, new Date());
    assert.equal('what' in (e as object), false);
  });
});

describe('buildViewingActivityEvent', () => {
  it('carries the playlist login and the viewer address', () => {
    const e = buildViewingActivityEvent({ playlistUsername: ' drew.l ', clientIp: '203.0.113.9' }, new Date('2026-10-27T20:00:00Z'));
    assert.deepEqual(e, {
      event_type: 'viewing.activity',
      timestamp: '2026-10-27T20:00:00.000Z',
      occurred_at: '2026-10-27T20:00:00.000Z',
      playlist_username: 'drew.l',
      client_ip: '203.0.113.9',
    });
  });
  it('lowercases the e-mail and leaves out what it does not know', () => {
    const e = buildViewingActivityEvent({ email: 'Drew@Example.com' }, new Date(0))!;
    assert.equal(e.user_email, 'drew@example.com');
    assert.equal('playlist_username' in e, false);
    assert.equal('client_ip' in e, false);
  });
  it('sends nothing when nobody is identifiable', () => {
    assert.equal(buildViewingActivityEvent({ playlistUsername: ' ', clientIp: '' }, new Date()), null);
  });
});

describe('throttleKey', () => {
  it('prefers the playlist login, then e-mail, then address', () => {
    assert.equal(throttleKey({ playlistUsername: 'Drew', email: 'a@b.c', clientIp: '1.1.1.1' }), 'login:drew');
    assert.equal(throttleKey({ email: 'A@b.c', clientIp: '1.1.1.1' }), 'email:a@b.c');
    assert.equal(throttleKey({ clientIp: '1.1.1.1' }), 'ip:1.1.1.1');
  });
});

describe('viewing activity emitter', () => {
  it('sends once per person per throttle window, then again after it', async () => {
    const h = harness();
    assert.equal(await h.emitter.send({ playlistUsername: 'drew', clientIp: '1.1.1.1' }), true);
    assert.equal(await h.emitter.send({ playlistUsername: 'DREW', clientIp: '2.2.2.2' }), false);
    h.advance(THROTTLE_MS - 1);
    assert.equal(await h.emitter.send({ playlistUsername: 'drew' }), false);
    h.advance(1);
    assert.equal(await h.emitter.send({ playlistUsername: 'drew' }), true);
    assert.equal(h.posted.length, 2);
  });

  it('keeps different people apart', async () => {
    const h = harness();
    await h.emitter.send({ playlistUsername: 'drew' });
    await h.emitter.send({ playlistUsername: 'sam' });
    await h.emitter.send({ clientIp: '9.9.9.9' });
    assert.equal(h.posted.length, 3);
  });

  it('two streams starting together send one event', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.emitter.send({ playlistUsername: 'drew' }), h.emitter.send({ playlistUsername: 'drew' })]);
    assert.deepEqual([a, b].sort(), [false, true]);
  });

  it('pauses after a failure so a down WatchTower is not hammered, then retries', async () => {
    const h = harness({ ok: false, error: 'HTTP 502' });
    assert.equal(await h.emitter.send({ playlistUsername: 'drew' }), false);
    assert.equal(await h.emitter.send({ playlistUsername: 'sam' }), false);
    assert.equal(h.posted.length, 1, 'second person is not tried during the pause');
    h.set({ ok: true });
    h.advance(FAILURE_BACKOFF_MS);
    assert.equal(await h.emitter.send({ playlistUsername: 'drew' }), true, 'a failed send does not use up the throttle slot');
  });

  it('does nothing when WatchTower is not linked, and never throws', async () => {
    const posted: unknown[] = [];
    const unlinked = createViewingActivityEmitter({ link: async () => null, post: async (_l, e) => (posted.push(e), { ok: true }) });
    assert.equal(await unlinked.send({ playlistUsername: 'drew' }), false);
    const broken = createViewingActivityEmitter({ link: async () => { throw new Error('db down'); } });
    assert.equal(await broken.send({ playlistUsername: 'drew' }), false);
    assert.doesNotThrow(() => broken.emit({ playlistUsername: 'drew' }));
    assert.equal(posted.length, 0);
  });
});

describe('postSignedEvent', () => {
  it('signs the exact body with sha256= and posts to the 24/7 webhook route', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const event = { event_type: 'viewing.activity', playlist_username: 'drew' };
    const result = await postSignedEvent(link, event, { fetch: fakeFetch });
    assert.deepEqual(result, { ok: true });
    assert.equal(seen!.url, 'http://wt.local/api/webhooks/twentyfourseven/');
    const body = String(seen!.init.body);
    const expected = `sha256=${createHmac('sha256', 'shared-secret').update(body).digest('hex')}`;
    assert.equal((seen!.init.headers as Record<string, string>)['X-Webhook-Signature'], expected);
    assert.equal(signBody('shared-secret', body), expected);
  });

  it('reports a refusal or a network error without leaking the secret', async () => {
    const refused = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    assert.deepEqual(await postSignedEvent(link, {}, { fetch: refused }), { ok: false, error: 'HTTP 401' });
    const down = (async () => { throw new TypeError('fetch failed shared-secret'); }) as unknown as typeof fetch;
    const r = await postSignedEvent(link, {}, { fetch: down });
    assert.equal(r.ok, false);
    assert.doesNotMatch(JSON.stringify(r), /shared-secret/);
  });
});
