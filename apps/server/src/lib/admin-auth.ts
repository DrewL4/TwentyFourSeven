import { ORPCError } from '@orpc/server';
import { needsRecheck, normalizeRole, roleRank, type FreshRole, type RoleUser, type TfsRole } from './wt-roles';

export const ADMIN_REQUIRED_MESSAGE =
  'Admin access required. Only WatchTower admins can manage TFS.';

export const MANAGER_REQUIRED_MESSAGE =
  'Manager or admin access required. Ask a WatchTower admin.';

type RoleRow = {
  id?: string;
  role: string;
  isActive?: boolean | null;
  watchTowerUserId?: string | null;
  watchTowerMetadata?: unknown;
};

type RoleLookup = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; role: true; isActive: true; watchTowerUserId: true; watchTowerMetadata: true };
    }): Promise<RoleRow | null>;
  };
};

type Refresher = (user: RoleUser) => Promise<FreshRole>;
let refresher: Refresher | null = null;

/** Tests swap this for a fake WatchTower. The default is the real checker (loaded only when a re-check is due). */
export function setRoleRefresher(next: Refresher | null) {
  refresher = next;
}

async function refresh(user: RoleUser): Promise<FreshRole> {
  if (refresher) return refresher(user);
  const { roleChecker } = await import('./wt-roles-runtime');
  return roleChecker.ensureFreshRole(user);
}

export type EffectiveRole = TfsRole;

/**
 * The role this request acts with. WatchTower is the source of truth: anyone above USER
 * linked to a WatchTower account is re-checked when their copy is over 5 minutes old, and
 * if WatchTower can't confirm they act as USER (fail closed). Unknown or inactive = USER.
 */
export async function getEffectiveRole(userId: string, prisma: RoleLookup): Promise<EffectiveRole> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, watchTowerUserId: true, watchTowerMetadata: true },
  });
  if (!row || row.isActive === false) return 'USER';
  const role = normalizeRole(row.role);
  if (role === 'USER') return 'USER';
  if (!needsRecheck({ id: userId, ...row }, Date.now())) return role;
  return (await refresh({ id: userId, ...row })).role;
}

/** Check if user is admin (owner or admin in WatchTower). */
export async function isAdmin(userId: string, prisma: RoleLookup): Promise<boolean> {
  return (await getEffectiveRole(userId, prisma)) === 'ADMIN';
}

/** Manager or admin: may edit channels and franchises. */
export async function isManagerOrAdmin(userId: string, prisma: RoleLookup): Promise<boolean> {
  return roleRank(await getEffectiveRole(userId, prisma)) >= 1;
}

/**
 * Require admin role. Throws ORPCError so callers get 401/403 with a readable
 * message instead of a masked "Internal server error".
 */
export async function requireAdminAsync(
  userId: string | undefined,
  prisma: RoleLookup
): Promise<void> {
  if (!userId) {
    throw new ORPCError('UNAUTHORIZED');
  }

  if (!(await isAdmin(userId, prisma))) {
    throw new ORPCError('FORBIDDEN', { message: ADMIN_REQUIRED_MESSAGE });
  }
}

export async function requireManagerAsync(
  userId: string | undefined,
  prisma: RoleLookup
): Promise<void> {
  if (!userId) {
    throw new ORPCError('UNAUTHORIZED');
  }

  if (!(await isManagerOrAdmin(userId, prisma))) {
    throw new ORPCError('FORBIDDEN', { message: MANAGER_REQUIRED_MESSAGE });
  }
}

type SettingsWithSecrets = {
  watchTowerPassword: string;
  tmdbApiKey: string;
  plexSettings: { token: string } | null;
};

/** Blank credentials before returning settings to a non-admin or anonymous caller. */
export function redactSettingsSecrets<T extends SettingsWithSecrets>(settings: T): T & { tmdbKeyConfigured: boolean } {
  return {
    ...settings,
    watchTowerPassword: '',
    tmdbApiKey: '',
    // Managers search TMDB through the server; they only need to know a key is set.
    tmdbKeyConfigured: Boolean(settings.tmdbApiKey),
    plexSettings: settings.plexSettings ? { ...settings.plexSettings, token: '' } : null,
  };
}
