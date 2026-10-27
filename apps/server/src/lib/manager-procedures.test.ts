import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ORPCError, call } from '@orpc/server';
import { z } from 'zod';

// Admin roles Phase 5: what a Manager can and cannot reach, and what gets audited.
const dir = mkdtempSync(path.join(tmpdir(), 'tfs-mgr-'));
process.env.DATABASE_URL = `file:${path.join(dir, 't.db')}`;
let prisma: typeof import('./prisma').prisma;
let orpc: typeof import('./orpc');
let routers: typeof import('../routers/index');
let sinkModule: typeof import('./orpc-audit');
let adminAuth: typeof import('./admin-auth');
const events: any[] = [];

before(async () => {
  execFileSync('npx', ['prisma', 'db', 'push', '--schema', './prisma/schema', '--skip-generate'], {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'ignore',
  });
  ({ prisma } = await import('./prisma'));
  orpc = await import('./orpc');
  routers = await import('../routers/index');
  sinkModule = await import('./orpc-audit');
  adminAuth = await import('./admin-auth');
  sinkModule.setAuditSink(async (e) => void events.push(e));
  // Local test users have no WatchTower link, so the stored role is trusted.
});

after(async () => {
  sinkModule?.setAuditSink(null);
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function seed(id: string, role: string, extra: Record<string, unknown> = {}) {
  await prisma.user.upsert({
    where: { id },
    update: { role, isActive: true },
    create: { id, name: `User ${id}`, email: `${id}@example.test`, emailVerified: true, role, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...extra } as any,
  });
}
const ctx = (id: string) => ({ session: { user: { id } } as any, db: prisma, ip: '10.0.0.5', userAgent: 'test' });
const forbidden = (e: unknown) => e instanceof ORPCError && e.code === 'FORBIDDEN';
const unauthorized = (e: unknown) => e instanceof ORPCError && e.code === 'UNAUTHORIZED';

beforeEach(async () => {
  events.length = 0;
  await seed('mgr', 'MANAGER', { watchTowerUserId: '42' });
  await seed('adm', 'ADMIN');
  await seed('usr', 'USER');
});

describe('managerProcedure', () => {
  const proc = () => orpc.managerProcedure.handler(() => 'ok');
  it('lets Manager and Admin in, refuses User, and signed-out callers get 401', async () => {
    assert.equal(await call(proc(), undefined, { context: ctx('mgr') }), 'ok');
    assert.equal(await call(proc(), undefined, { context: ctx('adm') }), 'ok');
    await assert.rejects(call(proc(), undefined, { context: ctx('usr') }), forbidden);
    await assert.rejects(call(proc(), undefined, { context: { session: null as any, db: prisma } }), unauthorized);
  });
  it('an inactive manager is refused', async () => {
    await prisma.user.update({ where: { id: 'mgr' }, data: { isActive: false } });
    await assert.rejects(call(proc(), undefined, { context: ctx('mgr') }), unauthorized);
  });
});

describe('adminProcedure', () => {
  const proc = () => orpc.adminProcedure.handler(() => 'ok');
  it('Admin only: Manager and User are refused', async () => {
    assert.equal(await call(proc(), undefined, { context: ctx('adm') }), 'ok');
    await assert.rejects(call(proc(), undefined, { context: ctx('mgr') }), forbidden);
    await assert.rejects(call(proc(), undefined, { context: ctx('usr') }), forbidden);
  });
  it('a manager copy that WatchTower cannot confirm falls back to USER', async () => {
    await prisma.user.update({ where: { id: 'adm' }, data: { watchTowerUserId: '9', watchTowerMetadata: { wt_role_checked_at: '2000-01-01T00:00:00Z' } } });
    adminAuth.setRoleRefresher(async () => ({ role: 'USER', verified: false, revoked: false }));
    try {
      await assert.rejects(call(proc(), undefined, { context: ctx('adm') }), forbidden);
    } finally {
      adminAuth.setRoleRefresher(null);
    }
  });
});

describe('real routes by role', () => {
  // Invalid input is on purpose: a call that passes the role gate then fails validation
  // instead of doing anything. FORBIDDEN means the role gate stopped it.
  const bad = { __invalid: true };
  const managerAllowed: Array<[string, any]> = [
    ['channels.update', () => (routers.appRouter as any).channels.update],
    ['channels.delete', () => (routers.appRouter as any).channels.delete],
    ['franchises.delete', () => (routers.appRouter as any).franchises.delete],
    ['programming.generateForChannel', () => (routers.appRouter as any).programming.generateForChannel],
  ];
  const adminOnly: Array<[string, any]> = [
    ['servers.create', () => (routers.appRouter as any).servers.create],
    ['servers.delete', () => (routers.appRouter as any).servers.delete],
    ['viewers.blockIp', () => (routers.appRouter as any).viewers.blockIp],
    ['viewers.deleteMapping', () => (routers.appRouter as any).viewers.deleteMapping],
    ['viewers.assignIpToUser', () => (routers.appRouter as any).viewers.assignIpToUser],
  ];

  for (const [name, get] of managerAllowed) {
    it(`${name}: Manager passes the gate, User is refused`, async () => {
      await assert.rejects(call(get(), bad, { context: ctx('mgr') }), (e: unknown) => !forbidden(e));
      await assert.rejects(call(get(), bad, { context: ctx('usr') }), forbidden);
    });
  }
  for (const [name, get] of adminOnly) {
    it(`${name}: Admin passes the gate, Manager and User are refused`, async () => {
      await assert.rejects(call(get(), bad, { context: ctx('adm') }), (e: unknown) => !forbidden(e));
      await assert.rejects(call(get(), bad, { context: ctx('mgr') }), forbidden);
      await assert.rejects(call(get(), bad, { context: ctx('usr') }), forbidden);
    });
  }
});

describe('audit events from procedures', () => {
  it('writes, denied attempts and reads', async () => {
    const router = {
      channels: {
        update: orpc.managerProcedure.input(z.object({ id: z.string(), name: z.string(), plexToken: z.string().optional() }) as any).handler(() => 'ok'),
        get: orpc.managerProcedure.handler(() => 'ok'),
      },
      servers: { delete: orpc.adminProcedure.handler(() => 'ok') },
    };
    await call(router.channels.update as any, { id: 'c1', name: 'News', plexToken: 'secret-value' }, { context: ctx('mgr'), path: ['channels', 'update'] } as any);
    await call(router.channels.get as any, undefined, { context: ctx('mgr'), path: ['channels', 'get'] } as any);
    await assert.rejects(call(router.servers.delete as any, undefined, { context: ctx('mgr'), path: ['servers', 'delete'] } as any), forbidden);
    await assert.rejects(call(router.servers.delete as any, undefined, { context: ctx('usr'), path: ['servers', 'delete'] } as any), forbidden);

    assert.deepEqual(events.map((e) => [e.action, e.result, e.actor?.role]), [
      ['channels.update', 'ok', 'manager'],
      ['servers.delete', 'denied', 'manager'],
      ['servers.delete', 'denied', 'user'],
    ]);
    const write = events[0];
    assert.equal(write.actor.id, '42');
    assert.equal(write.targetId, 'c1');
    assert.equal(write.ip, '10.0.0.5');
    assert.deepEqual(write.changes.name, { before: null, after: 'News' });
    assert.equal(JSON.stringify(write).includes('secret-value'), false);
  });

  it('a failing audit sink never breaks the action', async () => {
    sinkModule.setAuditSink(async () => {
      throw new Error('outbox down');
    });
    try {
      const router = { channels: { update: orpc.managerProcedure.handler(() => 'ok') } };
      assert.equal(await call(router.channels.update as any, undefined, { context: ctx('mgr'), path: ['channels', 'update'] } as any), 'ok');
    } finally {
      sinkModule.setAuditSink(async (e) => void events.push(e));
    }
  });

  it('Manager and Admin sign-ins are logged, User sign-ins are not', async () => {
    await sinkModule.auditElevatedLogin({ userId: 'mgr', role: 'MANAGER', db: prisma, method: 'watchtower', ip: '1.1.1.1' });
    await sinkModule.auditElevatedLogin({ userId: 'adm', role: 'ADMIN', db: prisma, method: 'watchtower' });
    await sinkModule.auditElevatedLogin({ userId: 'usr', role: 'USER', db: prisma, method: 'watchtower' });
    assert.deepEqual(events.map((e) => [e.action, e.actor.role, e.ip]), [['auth.login', 'manager', '1.1.1.1'], ['auth.login', 'admin', undefined]]);
  });
});

describe('franchises.createChannel (wish 16)', () => {
  it('a Manager makes one channel per franchise, numbered from 100 and grouped', async () => {
    const f = await prisma.franchise.create({ data: { slug: 'star-wars-t', name: 'Star Wars Collection' } });
    await prisma.channel.create({ data: { number: 100, name: 'Taken' } });
    const proc = (routers as any).appRouter.franchises.createChannel;
    await assert.rejects(call(proc, { franchiseId: f.id }, { context: ctx('mgr') }), /no movies yet/);
    assert.equal(await prisma.channel.count({ where: { franchiseId: f.id } }), 0);
    await prisma.franchiseEntry.create({ data: { franchiseId: f.id, position: 1, tmdbId: 11, label: 'A New Hope' } });
    const first: any = await call(proc, { franchiseId: f.id }, { context: ctx('mgr') });
    assert.equal(first.created, true);
    assert.equal(first.number, 101);
    assert.equal(first.name, 'Star Wars');
    const row = await prisma.channel.findUnique({ where: { id: first.id } });
    assert.equal(row?.groupTitle, 'Franchises');
    assert.equal(row?.franchiseId, f.id);
    const again: any = await call(proc, { franchiseId: f.id }, { context: ctx('mgr') });
    assert.equal(again.created, false);
    assert.equal(again.id, first.id);
    await assert.rejects(call(proc, { franchiseId: f.id }, { context: ctx('usr') }), forbidden);
  });
});
