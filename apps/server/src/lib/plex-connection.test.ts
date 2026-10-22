import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlexAPI, PlexRequestError, describePlexHttpError, describePlexNetworkError } from './plex';

// Minimal stand-in for Plex: /identity is open (like real Plex), /library/sections needs the token.
let server: Server;
let base = '';
before(async () => {
  server = createServer((req, res) => {
    const token = req.headers['x-plex-token'];
    if (req.url === '/identity') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ MediaContainer: { machineIdentifier: 'x' } }));
      return;
    }
    if (req.url === '/library/sections') {
      if (token === 'good') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ MediaContainer: { Directory: [{ key: '1', title: 'Lab Movies', type: 'movie' }] } }));
      } else if (token === 'html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>not plex</html>');
      } else {
        res.writeHead(401);
        res.end();
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

describe('Plex connection check', () => {
  it('a working token lists libraries and checks ok', async () => {
    const plex = new PlexAPI({ uri: base });
    assert.deepEqual((await plex.getLibraries(base, 'good')).map((l) => l.title), ['Lab Movies']);
    assert.deepEqual(await plex.checkConnection(base, 'good'), { ok: true });
    assert.equal(await plex.testConnection(base, 'good'), true);
  });

  it('a refused token is not "successful" even though /identity answers', async () => {
    const plex = new PlexAPI({ uri: base });
    const result = await plex.checkConnection(base, 'wrong');
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /refused the token \(HTTP 401\).*X-Plex-Token/);
    await assert.rejects(plex.getLibraries(base, 'wrong'), PlexRequestError);
  });

  it('says when the URL is not Plex', async () => {
    const plex = new PlexAPI({ uri: base });
    const result = await plex.checkConnection(base, 'html');
    assert.match(!result.ok ? result.error : '', /not with Plex library data/);
  });

  it('says when Plex cannot be reached', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const dead = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise((resolve) => closed.close(resolve));
    const result = await new PlexAPI({ uri: dead }).checkConnection(dead, 'good');
    assert.equal(!result.ok ? result.error : '', `Can't reach Plex at ${dead} (ECONNREFUSED). Check the address and that TFS can reach it.`);
  });
});

describe('Plex error wording', () => {
  it('names other HTTP statuses', () => {
    assert.equal(describePlexHttpError('http://p:32400', 500, 'Internal Server Error'),
      'Plex at http://p:32400 answered HTTP 500 Internal Server Error when listing libraries.');
  });
  it('explains timeouts and DNS failures', () => {
    assert.match(describePlexNetworkError('http://p', Object.assign(new Error('t'), { name: 'TimeoutError' })), /no answer within 10 seconds/);
    assert.match(describePlexNetworkError('http://p', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), /\(ENOTFOUND\)/);
  });
});
