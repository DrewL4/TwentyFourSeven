import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createRoleChecker,
  FAILURE_COOLDOWN_MS,
  isStaleRoleVersion,
  isStaffRole,
  lostRankOrActive,
  mapWtRole,
  needsRecheck,
  RECHECK_AFTER_MS,
  roleRank,
  withRoleFields,
  type RoleUser,
  type WtRolePayload,
} from './wt-roles';
import { lostAccess } from './user-access';
import { getEffectiveRole, isAdmin, isManagerOrAdmin, requireManagerAsync, setRoleRefresher } from './admin-auth';

describe('mapWtRole', () => {
  it('owner and admin are ADMIN, manager is MANAGER, user and unknown are USER', () => {
    assert.equal(mapWtRole({ role: 'owner' }), 'ADMIN');
    assert.equal(mapWtRole({ role: 'admin' }), 'ADMIN');
    assert.equal(mapWtRole({ role: ' Manager ' }), 'MANAGER');
    assert.equal(mapWtRole({ role: 'user' }), 'USER');
    assert.equal(mapWtRole({ role: 'superhero' }), 'USER');
    assert.equal(mapWtRole(null), 'USER');
  });
  it('the role wins over a stale is_admin flag', () => {
    assert.equal(mapWtRole({ role: 'manager', is_admin: true }), 'MANAGER');
    assert.equal(mapWtRole({ role: 'user', is_admin: true }), 'USER');
  });
  it('older WatchTower without a role falls back to the admin flags', () => {
    assert.equal(mapWtRole({ is_admin: true }), 'ADMIN');
    assert.equal(mapWtRole({ is_staff: true, is_superuser: true }), 'ADMIN');
    assert.equal(mapWtRole({ is_staff: true }), 'USER');
    assert.equal(mapWtRole({}), 'USER');
  });
  it('managers count as staff (always have 24/7 access)', () => {
    assert.equal(isStaffRole({ role: 'manager' }), true);
    assert.equal(isStaffRole({ role: 'user' }), false);
  });
});

describe('role_version guard', () => {
  it('ignores only strictly older versions', () => {
    assert.equal(isStaleRoleVersion(5, 4), true);
    assert.equal(isStaleRoleVersion(5, 5), false);
    assert.equal(isStaleRoleVersion(5, 6), false);
  });
  it('applies when either side has no version', () => {
    assert.equal(isStaleRoleVersion(null, 1), false);
    assert.equal(isStaleRoleVersion(3, undefined), false);
    assert.equal(isStaleRoleVersion(undefined, undefined), false);
  });
  it('stores the role copy with a check time and keeps other metadata', () => {
    const m = withRoleFields({ keep: 1 }, { role: 'manager', role_version: 7, perms: ['tfs.channels.edit', 3] }, Date.parse('2026-10-27T20:00:00Z'));
    assert.deepEqual(m, { keep: 1, wt_role: 'manager', wt_role_version: 7, wt_perms: ['tfs.channels.edit'], wt_role_checked_at: '2026-10-27T20:00:00.000Z' });
  });
});

describe('lostAccess (demotion logs out)', () => {
  it('any drop in rank or deactivation loses access', () => {
    assert.equal(lostAccess({ isActive: true, role: 'ADMIN' }, { isActive: true, role: 'MANAGER' }), true);
    assert.equal(lostAccess({ isActive: true, role: 'ADMIN' }, { isActive: true, role: 'USER' }), true);
    assert.equal(lostAccess({ isActive: true, role: 'MANAGER' }, { isActive: true, role: 'USER' }), true);
    assert.equal(lostAccess({ isActive: true, role: 'USER' }, { isActive: false, role: 'USER' }), true);
  });
  it('promotions, no change and reactivation do not', () => {
    assert.equal(lostAccess({ isActive: true, role: 'MANAGER' }, { isActive: true, role: 'ADMIN' }), false);
    assert.equal(lostAccess({ isActive: true, role: 'MANAGER' }, { isActive: true, role: 'MANAGER' }), false);
    assert.equal(lostAccess({ isActive: false, role: 'USER' }, { isActive: true, role: 'USER' }), false);
    assert.equal(lostRankOrActive({ isActive: true, role: 'ADMIN' }, { isActive: true, role: 'ADMIN' }), false);
    assert.equal(roleRank('ADMIN') > roleRank('MANAGER'), true);
  });
});

const T0 = Date.parse('2026-10-27T20:00:00Z');
const stale = new Date(T0 - RECHECK_AFTER_MS - 1000).toISOString();
const fresh = new Date(T0 - 60 * 1000).toISOString();

function user(over: Partial<RoleUser> = {}): RoleUser {
  return { id: 'u1', role: 'MANAGER', isActive: true, watchTowerUserId: '42', watchTowerMetadata: { wt_role_checked_at: stale, wt_role_version: 3 }, ...over };
}

describe('needsRecheck', () => {
  it('only for staff linked to WatchTower with an old or missing check', () => {
    assert.equal(needsRecheck(user(), T0), true);
    assert.equal(needsRecheck(user({ watchTowerMetadata: { wt_role_checked_at: fresh } }), T0), false);
    assert.equal(needsRecheck(user({ watchTowerMetadata: null }), T0), true);
    assert.equal(needsRecheck(user({ role: 'USER' }), T0), false);
    assert.equal(needsRecheck(user({ watchTowerUserId: null }), T0), false);
  });
});

function checker(opts: { wt: () => WtRolePayload | null | Promise<WtRolePayload | null>; linked?: boolean }) {
  const calls = { fetch: 0, saved: [] as Array<Record<string, unknown>>, signedOut: [] as string[] };
  let clock = T0;
  const c = createRoleChecker({
    fetchWtUser: async () => {
      calls.fetch += 1;
      return opts.wt();
    },
    isLinked: async () => opts.linked ?? true,
    save: async (_id, data) => void calls.saved.push(data),
    signOut: async (id) => void calls.signedOut.push(id),
    now: () => clock,
  });
  return { ...c, calls, advance: (ms: number) => (clock += ms) };
}

describe('role checker', () => {
  it('a fresh copy is trusted without asking WatchTower', async () => {
    const h = checker({ wt: () => ({ role: 'user' }) });
    const r = await h.ensureFreshRole(user({ watchTowerMetadata: { wt_role_checked_at: fresh } }));
    assert.deepEqual(r, { role: 'MANAGER', verified: true, revoked: false });
    assert.equal(h.calls.fetch, 0);
  });

  it('a stale copy still valid is confirmed and the check time is saved', async () => {
    const h = checker({ wt: () => ({ role: 'manager', role_version: 3, is_active: true }) });
    const r = await h.ensureFreshRole(user());
    assert.deepEqual(r, { role: 'MANAGER', verified: true, revoked: false });
    assert.equal(h.calls.saved.length, 1);
    assert.equal((h.calls.saved[0].watchTowerMetadata as any).wt_role_checked_at, new Date(T0).toISOString());
    assert.deepEqual(h.calls.signedOut, []);
  });

  it('admin demoted to manager: new role used, signed out everywhere', async () => {
    const h = checker({ wt: () => ({ role: 'manager', role_version: 4 }) });
    const r = await h.ensureFreshRole(user({ role: 'ADMIN' }));
    assert.deepEqual(r, { role: 'MANAGER', verified: true, revoked: true });
    assert.equal(h.calls.saved[0].role, 'MANAGER');
    assert.deepEqual(h.calls.signedOut, ['u1']);
  });

  it('manager demoted to user: acts as USER, signed out', async () => {
    const h = checker({ wt: () => ({ role: 'user', role_version: 4 }) });
    const r = await h.ensureFreshRole(user());
    assert.deepEqual(r, { role: 'USER', verified: true, revoked: true });
    assert.deepEqual(h.calls.signedOut, ['u1']);
  });

  it('deactivated in WatchTower: deactivated here, signed out, acts as USER', async () => {
    const h = checker({ wt: () => ({ role: 'admin', role_version: 4, is_active: false }) });
    const r = await h.ensureFreshRole(user({ role: 'ADMIN' }));
    assert.deepEqual(r, { role: 'USER', verified: true, revoked: true });
    assert.equal(h.calls.saved[0].isActive, false);
    assert.deepEqual(h.calls.signedOut, ['u1']);
  });

  it('promotion is applied and nobody is signed out', async () => {
    const h = checker({ wt: () => ({ role: 'admin', role_version: 4 }) });
    const r = await h.ensureFreshRole(user());
    assert.deepEqual(r, { role: 'ADMIN', verified: true, revoked: false });
    assert.deepEqual(h.calls.signedOut, []);
  });

  it('fails closed when WatchTower cannot be reached: USER, nothing saved, nobody signed out', async () => {
    const h = checker({ wt: () => null });
    const r = await h.ensureFreshRole(user({ role: 'ADMIN' }));
    assert.deepEqual(r, { role: 'USER', verified: false, revoked: false });
    assert.equal(h.calls.saved.length, 0);
    assert.deepEqual(h.calls.signedOut, []);
  });

  it('fails closed when the lookup throws', async () => {
    const h = checker({ wt: () => { throw new Error('boom'); } });
    assert.equal((await h.ensureFreshRole(user())).role, 'USER');
  });

  it('after a failure, does not ask again until the cooldown passes', async () => {
    let up = false;
    const h = checker({ wt: () => (up ? { role: 'manager', role_version: 3 } : null) });
    await h.ensureFreshRole(user());
    await h.ensureFreshRole(user());
    assert.equal(h.calls.fetch, 1);
    up = true;
    h.advance(FAILURE_COOLDOWN_MS);
    assert.deepEqual(await h.ensureFreshRole(user()), { role: 'MANAGER', verified: true, revoked: false });
  });

  it('an older role_version from WatchTower is not trusted (fail closed)', async () => {
    const h = checker({ wt: () => ({ role: 'admin', role_version: 1 }) });
    const r = await h.ensureFreshRole(user());
    assert.equal(r.verified, false);
    assert.equal(r.role, 'USER');
    assert.equal(h.calls.saved.length, 0);
  });

  it('concurrent requests share one WatchTower call', async () => {
    const h = checker({ wt: async () => ({ role: 'manager', role_version: 3 }) });
    await Promise.all([h.ensureFreshRole(user()), h.ensureFreshRole(user()), h.ensureFreshRole(user())]);
    assert.equal(h.calls.fetch, 1);
  });

  it('trusts the stored role when WatchTower is not set up here, and for local admins', async () => {
    const unlinked = checker({ wt: () => null, linked: false });
    assert.equal((await unlinked.ensureFreshRole(user())).role, 'MANAGER');
    const local = checker({ wt: () => null });
    assert.equal((await local.ensureFreshRole(user({ role: 'ADMIN', watchTowerUserId: null }))).role, 'ADMIN');
    assert.equal(local.calls.fetch, 0);
  });

  it('inactive users act as USER', async () => {
    const h = checker({ wt: () => ({ role: 'admin' }) });
    assert.equal((await h.ensureFreshRole(user({ isActive: false }))).role, 'USER');
  });
});

describe('getEffectiveRole / role guards', () => {
  const rows: Record<string, any> = {
    admin: { role: 'ADMIN', isActive: true },
    manager: { role: 'MANAGER', isActive: true },
    viewer: { role: 'USER', isActive: true },
    off: { role: 'ADMIN', isActive: false },
    linked: { role: 'ADMIN', isActive: true, watchTowerUserId: '9', watchTowerMetadata: { wt_role_checked_at: '2000-01-01T00:00:00Z' } },
  };
  const db = { user: { findUnique: async ({ where }: any) => rows[where.id] ?? null } } as any;

  it('maps stored roles', async () => {
    assert.equal(await getEffectiveRole('admin', db), 'ADMIN');
    assert.equal(await getEffectiveRole('manager', db), 'MANAGER');
    assert.equal(await getEffectiveRole('viewer', db), 'USER');
    assert.equal(await getEffectiveRole('off', db), 'USER');
    assert.equal(await getEffectiveRole('nobody', db), 'USER');
  });
  it('manager is not admin; admin is manager-or-admin', async () => {
    assert.equal(await isAdmin('manager', db), false);
    assert.equal(await isManagerOrAdmin('manager', db), true);
    assert.equal(await isManagerOrAdmin('admin', db), true);
    assert.equal(await isManagerOrAdmin('viewer', db), false);
    await requireManagerAsync('manager', db);
    await assert.rejects(requireManagerAsync('viewer', db), (e: any) => e.code === 'FORBIDDEN');
    await assert.rejects(requireManagerAsync(undefined, db), (e: any) => e.code === 'UNAUTHORIZED');
  });
  it('a stale linked admin is re-checked; unconfirmed means USER, confirmed means the new role', async () => {
    setRoleRefresher(async () => ({ role: 'USER', verified: false, revoked: false }));
    assert.equal(await isAdmin('linked', db), false);
    setRoleRefresher(async () => ({ role: 'MANAGER', verified: true, revoked: true }));
    assert.equal(await getEffectiveRole('linked', db), 'MANAGER');
    setRoleRefresher(async () => ({ role: 'ADMIN', verified: true, revoked: false }));
    assert.equal(await isAdmin('linked', db), true);
    setRoleRefresher(null);
  });
});
