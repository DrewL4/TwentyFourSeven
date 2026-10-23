import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORPCError, call } from '@orpc/server';
import { isAdmin, redactSettingsSecrets, requireAdminAsync } from './admin-auth';
import { integrationTokenMatches } from './integration-token';
import { appRouter } from '../routers';

const fakeDb = (roles: Record<string, string>) => ({
  user: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      roles[where.id] ? { role: roles[where.id] } : null,
  },
});

const db = fakeDb({ admin: 'ADMIN', viewer: 'USER' });

describe('isAdmin / requireAdminAsync', () => {
  it('only the ADMIN role is admin', async () => {
    assert.equal(await isAdmin('admin', db), true);
    assert.equal(await isAdmin('viewer', db), false);
    assert.equal(await isAdmin('nobody', db), false);
  });

  it('throws ORPC 401/403, not a plain Error that becomes "Internal server error"', async () => {
    await assert.rejects(requireAdminAsync(undefined, db), (e: unknown) => e instanceof ORPCError && e.code === 'UNAUTHORIZED');
    await assert.rejects(requireAdminAsync('viewer', db), (e: unknown) => e instanceof ORPCError && e.code === 'FORBIDDEN');
    await requireAdminAsync('admin', db);
  });
});

describe('redactSettingsSecrets', () => {
  it('blanks credentials and keeps everything else', () => {
    const out = redactSettingsSecrets({
      guideDays: 3,
      watchTowerPassword: 'pw',
      tmdbApiKey: 'key',
      plexSettings: { url: 'http://plex', token: 'tok' },
    });
    assert.equal(out.guideDays, 3);
    assert.equal(out.watchTowerPassword, '');
    assert.equal(out.tmdbApiKey, '');
    assert.deepEqual(out.plexSettings, { url: 'http://plex', token: '' });
    assert.equal(redactSettingsSecrets({ watchTowerPassword: '', tmdbApiKey: '', plexSettings: null }).plexSettings, null);
  });
});

describe('integrationTokenMatches', () => {
  it('requires the stored token exactly', () => {
    assert.equal(integrationTokenMatches('abc', 'abc'), true);
    assert.equal(integrationTokenMatches('abd', 'abc'), false);
    assert.equal(integrationTokenMatches('anything', ''), false);
    assert.equal(integrationTokenMatches('anything', undefined), false);
    assert.equal(integrationTokenMatches(null, 'abc'), false);
  });
});

// Viewer (WatchTower non-admin) access: home, guide, watch. Everything else in the
// oRPC router must be admin-only. Adding a procedure forces a decision here.
const VIEWER_PROCEDURES = new Set([
  'healthCheck',
  'privateData',
  'channels.list',
  'channels.listSummary',
  'channels.get',
  'channels.getLineup',
  'channels.getShowEpisodes',
  'library.stats',
  'library.debug',
  'library.shows',
  'library.movies',
  'library.search',
  'library.episodes',
  'library.collections',
  'library.showsByIds',
  'guide.current',
  'guide.channel',
  'catchup.getPrograms',
  'catchup.getStreamInfo',
  'catchup.isAvailable',
  'programming.status',
  'settings.get',
  'settings.playlistLogin.mine',
  'settings.playlistLogin.resetMine',
  'stream.channel',
  'stream.m3u',
  'stream.xmltv',
]);

type AnyNode = Record<string, unknown>;
function collectProcedures(node: AnyNode, prefix = ''): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && '~orpc' in (value as AnyNode)) out.push([path, value]);
    else if (value && typeof value === 'object') out.push(...collectProcedures(value as AnyNode, path));
  }
  return out;
}

describe('appRouter role gate', () => {
  const procedures = collectProcedures(appRouter as unknown as AnyNode);

  it('finds the router procedures', () => {
    assert.ok(procedures.length > 80, `only ${procedures.length} procedures found`);
    for (const name of VIEWER_PROCEDURES) {
      assert.ok(procedures.some(([p]) => p === name), `allowlisted ${name} no longer exists`);
    }
  });

  it('every non-viewer procedure refuses a viewer with FORBIDDEN before running', async () => {
    const context = { session: { user: { id: 'viewer' } }, db } as never;
    for (const [name, procedure] of procedures) {
      if (VIEWER_PROCEDURES.has(name)) continue;
      await assert.rejects(
        call(procedure as never, undefined as never, { context }),
        (e: unknown) => e instanceof ORPCError && e.code === 'FORBIDDEN',
        `${name} should be admin-only`,
      );
    }
  });

  it('every non-viewer procedure refuses an anonymous caller', async () => {
    const context = { session: null, db } as never;
    for (const [name, procedure] of procedures) {
      if (VIEWER_PROCEDURES.has(name) || name === 'privateData') continue;
      await assert.rejects(
        call(procedure as never, undefined as never, { context }),
        (e: unknown) => e instanceof ORPCError && e.code === 'UNAUTHORIZED',
        `${name} should need sign-in`,
      );
    }
  });
});
