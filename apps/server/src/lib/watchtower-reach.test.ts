import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkWatchTowerReachable,
  classifyWatchTowerLoginFailure,
  describeFetchError,
  isLoopbackUrl,
  watchTowerUnreachableMessage,
} from './watchtower-reach';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('isLoopbackUrl', () => {
  it('flags addresses that mean "this container"', () => {
    for (const url of ['http://localhost', 'http://localhost:3005', 'http://127.0.0.1:8000', 'http://[::1]:80']) {
      assert.equal(isLoopbackUrl(url), true, url);
    }
  });
  it('accepts LAN, container and public addresses', () => {
    for (const url of ['http://192.168.1.10:3005', 'http://wt-test-app:3000', 'https://wt.example.com', '']) {
      assert.equal(isLoopbackUrl(url), false, url);
    }
  });
});

describe('watchTowerUnreachableMessage', () => {
  it('names the address and explains localhost', () => {
    const msg = watchTowerUnreachableMessage('http://localhost', 'connection refused');
    assert.match(msg, /can't reach WatchTower at http:\/\/localhost \(connection refused\)/);
    assert.match(msg, /means TwentyFourSeven itself/);
    assert.match(msg, /Admin → Connections → WatchTower Guide & TFS Connect/);
  });
  it('has no localhost note for a real address', () => {
    assert.doesNotMatch(watchTowerUnreachableMessage('http://192.168.1.10:3005'), /itself/);
  });
});

describe('describeFetchError', () => {
  it('turns fetch causes into plain words', () => {
    assert.equal(describeFetchError({ cause: { code: 'ECONNREFUSED' } }), 'connection refused');
    assert.equal(describeFetchError({ cause: { code: 'ENOTFOUND' } }), 'address not found');
    assert.equal(describeFetchError({ name: 'TimeoutError' }), 'no answer in time');
  });
});

describe('classifyWatchTowerLoginFailure', () => {
  it('JSON 401 from WatchTower = wrong login', () => {
    const r = classifyWatchTowerLoginFailure('http://wt', 401, 'application/json', '{"error":"Invalid credentials"}');
    assert.equal(r.kind, 'bad_credentials');
    assert.match((r as { message: string }).message, /email or username and password/);
  });
  it('disabled account says so', () => {
    const r = classifyWatchTowerLoginFailure('http://wt', 401, 'application/json', '{"error":"Account is disabled"}');
    assert.match((r as { message: string }).message, /disabled/);
  });
  it('a redirect or web page is a connection problem, not bad credentials', () => {
    // The lab bug: WatchTower pushed http://localhost, so TFS hit its own nginx (308 -> 404 page).
    for (const [status, type] of [[308, 'text/html'], [404, 'text/html'], [502, 'text/html'], [500, 'application/json']] as const) {
      const r = classifyWatchTowerLoginFailure('http://localhost', status, type, '<html></html>');
      assert.equal(r.kind, 'not_watchtower', `${status} ${type}`);
      assert.match((r as { message: string }).message, /can't reach WatchTower at http:\/\/localhost/);
    }
  });
});

describe('checkWatchTowerReachable', () => {
  it('ok when WatchTower validates the token', async () => {
    const r = await checkWatchTowerReachable('http://wt', 't', (async () => jsonResponse(200, { valid: true })) as typeof fetch);
    assert.deepEqual(r, { ok: true });
  });
  it('explains a refused connection', async () => {
    const fail = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as typeof fetch;
    const r = await checkWatchTowerReachable('http://localhost', 't', fail);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /connection refused/);
  });
  it('a non-WatchTower answer is unreachable', async () => {
    const page = (async () => new Response('', { status: 308, headers: { location: '/x' } })) as typeof fetch;
    const r = await checkWatchTowerReachable('http://localhost', 't', page);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /HTTP 308/);
  });
  it('a rejected token says to create tokens again', async () => {
    const r = await checkWatchTowerReachable('http://wt', 't', (async () => jsonResponse(401, { error: 'Invalid token' })) as typeof fetch);
    assert.match((r as { error: string }).error, /Create App Tokens/);
  });
});
