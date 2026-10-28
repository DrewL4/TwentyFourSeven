/**
 * WatchTower owns roles (owner, admin, manager, user). TwentyFourSeven keeps a copy
 * and re-checks it, failing closed.
 *
 *  - owner and admin both mean TFS "ADMIN"; manager means "MANAGER"; user and anything
 *    unknown mean "USER". Older WatchTower versions send no `role`: then `is_admin` decides.
 *  - Every role change from WatchTower carries `role_version`. A change older than the
 *    stored one is ignored, so a late webhook can't undo a newer demotion.
 *  - Anyone above USER who is linked to a WatchTower account is re-checked with
 *    WatchTower when the copy is older than 5 minutes. If WatchTower can't confirm,
 *    that request treats them as a plain USER (nothing is saved, nothing is deleted).
 *  - A re-check that finds a demotion or deactivation signs them out everywhere.
 */

export type TfsRole = 'ADMIN' | 'MANAGER' | 'USER';

export const RECHECK_AFTER_MS = 5 * 60 * 1000;
export const FAILURE_COOLDOWN_MS = 30 * 1000;

const RANK: Record<TfsRole, number> = { USER: 0, MANAGER: 1, ADMIN: 2 };

export function roleRank(role: string | null | undefined): number {
  return RANK[normalizeRole(role)];
}

/** What TFS stored (already ADMIN/MANAGER/USER) or anything else, as a safe TfsRole. */
export function normalizeRole(role: string | null | undefined): TfsRole {
  return role === 'ADMIN' || role === 'MANAGER' ? role : 'USER';
}

export type WtRolePayload = {
  role?: unknown;
  role_version?: unknown;
  perms?: unknown;
  is_admin?: unknown;
  is_staff?: unknown;
  is_superuser?: unknown;
  is_active?: unknown;
  /** WatchTower: a Manager whose TV service or donation lapsed. They arrive with role 'user'. */
  role_lapsed?: unknown;
};

export function mapWtRole(u: WtRolePayload | null | undefined): TfsRole {
  if (!u) return 'USER';
  if (typeof u.role === 'string') {
    const role = u.role.trim().toLowerCase();
    if (role === 'owner' || role === 'admin') return 'ADMIN';
    if (role === 'manager') return 'MANAGER';
    return 'USER';
  }
  return u.is_admin === true || (u.is_staff === true && u.is_superuser === true) ? 'ADMIN' : 'USER';
}

/** Owner, admin or manager in WatchTower: staff always have 24/7 access, like admins before. */
export function isStaffRole(u: WtRolePayload | null | undefined): boolean {
  return mapWtRole(u) !== 'USER';
}

/**
 * A Manager who lapsed in WatchTower. WatchTower already sends them as role 'user', so they
 * have no staff powers here; they can still sign in, with User rights only.
 */
export function isLapsedManager(u: WtRolePayload | null | undefined): boolean {
  return !!u && u.role_lapsed === true && u.is_active !== false && mapWtRole(u) === 'USER';
}

/** Gets in without a movie service: staff, or a lapsed Manager (sign-in only, never staff powers). */
export function alwaysSignsIn(u: WtRolePayload | null | undefined): boolean {
  return isStaffRole(u) || isLapsedManager(u);
}

export function versionOf(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

/** True when `incoming` is older than what we stored, so the change must be ignored. No version on either side = apply. */
export function isStaleRoleVersion(stored: unknown, incoming: unknown): boolean {
  const s = versionOf(stored);
  const i = versionOf(incoming);
  return s !== null && i !== null && i < s;
}

type Meta = { [key: string]: any };

function metaOf(value: unknown): Meta {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Meta) : {};
}

export function storedRoleVersion(metadata: unknown): number | null {
  return versionOf(metaOf(metadata).wt_role_version);
}

export function roleCheckedAt(metadata: unknown): number | null {
  const raw = metaOf(metadata).wt_role_checked_at;
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** The copy of WatchTower's role fields kept in watchTowerMetadata, plus the time they were last confirmed. */
export function withRoleFields(metadata: unknown, u: WtRolePayload, now: number): Meta {
  const prev = metaOf(metadata);
  const version = versionOf(u.role_version);
  return {
    ...prev,
    wt_role: typeof u.role === 'string' ? u.role : prev.wt_role ?? null,
    wt_role_version: version ?? prev.wt_role_version ?? null,
    wt_perms: Array.isArray(u.perms) ? u.perms.filter((p) => typeof p === 'string') : prev.wt_perms ?? [],
    wt_role_checked_at: new Date(now).toISOString(),
  };
}

/** Someone loses access when they are deactivated or their role rank drops (admin→manager, manager→user, …). */
export function lostRankOrActive(
  before: { isActive: boolean; role: string },
  after: { isActive: boolean; role: string },
): boolean {
  return (before.isActive && !after.isActive) || roleRank(after.role) < roleRank(before.role);
}

export type RoleUser = {
  id: string;
  role: string;
  isActive?: boolean | null;
  watchTowerUserId?: string | null;
  watchTowerMetadata?: unknown;
};

/** Anyone above USER whose role comes from a WatchTower account, and whose copy is stale. */
export function needsRecheck(user: RoleUser, now: number): boolean {
  if (roleRank(user.role) === 0 || !user.watchTowerUserId) return false;
  const checked = roleCheckedAt(user.watchTowerMetadata);
  return checked === null || now - checked >= RECHECK_AFTER_MS;
}

export type RoleDeps = {
  /** WatchTower's current copy of the person, or null when it can't be read (down, 404, no token). */
  fetchWtUser(watchTowerUserId: string): Promise<WtRolePayload | null>;
  /** False when WatchTower isn't set up here (no address or API token), so there is nothing to ask. */
  isLinked(): Promise<boolean>;
  save(userId: string, data: { role: string; isActive?: boolean; watchTowerMetadata: Meta }): Promise<void>;
  signOut(userId: string): Promise<void>;
  now(): number;
};

export type FreshRole = {
  role: TfsRole;
  /** False when WatchTower couldn't confirm (the role shown is then USER). */
  verified: boolean;
  /** True when the re-check found a demotion or deactivation and signed the person out. */
  revoked: boolean;
};

export function createRoleChecker(deps: RoleDeps) {
  const failedAt = new Map<string, number>();
  const inFlight = new Map<string, Promise<FreshRole>>();

  async function recheck(user: RoleUser): Promise<FreshRole> {
    const failClosed: FreshRole = { role: 'USER', verified: false, revoked: false };
    const lastFail = failedAt.get(user.id);
    if (lastFail !== undefined && deps.now() - lastFail < FAILURE_COOLDOWN_MS) return failClosed;

    let wt: WtRolePayload | null = null;
    try {
      wt = await deps.fetchWtUser(user.watchTowerUserId as string);
    } catch {
      wt = null;
    }
    const stored = storedRoleVersion(user.watchTowerMetadata);
    if (!wt || isStaleRoleVersion(stored, wt.role_version)) {
      failedAt.set(user.id, deps.now());
      return failClosed;
    }
    failedAt.delete(user.id);

    const next = mapWtRole(wt);
    const active = wt.is_active !== false;
    const before = { isActive: user.isActive !== false, role: user.role };
    const after = { isActive: before.isActive && active, role: next };
    await deps.save(user.id, {
      role: next,
      ...(active ? {} : { isActive: false }),
      watchTowerMetadata: withRoleFields(user.watchTowerMetadata, wt, deps.now()),
    });
    const lost = lostRankOrActive(before, after);
    if (lost) await deps.signOut(user.id);
    return { role: active ? next : 'USER', verified: true, revoked: lost };
  }

  /** The role this request should act with. Never throws. */
  async function ensureFreshRole(user: RoleUser): Promise<FreshRole> {
    const role = normalizeRole(user.role);
    if (user.isActive === false) return { role: 'USER', verified: true, revoked: false };
    if (!needsRecheck(user, deps.now())) return { role, verified: true, revoked: false };
    try {
      if (!(await deps.isLinked())) return { role, verified: true, revoked: false };
    } catch {
      return { role: 'USER', verified: false, revoked: false };
    }
    const running = inFlight.get(user.id);
    if (running) return running;
    const p = recheck(user)
      .catch((): FreshRole => ({ role: 'USER', verified: false, revoked: false }))
      .finally(() => inFlight.delete(user.id));
    inFlight.set(user.id, p);
    return p;
  }

  return { ensureFreshRole };
}
