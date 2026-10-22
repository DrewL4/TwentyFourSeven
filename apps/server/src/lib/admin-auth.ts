import { ORPCError } from '@orpc/server';

export const ADMIN_REQUIRED_MESSAGE =
  'Admin access required. Only WatchTower admins can manage TFS.';

type RoleLookup = {
  user: {
    findUnique(args: { where: { id: string }; select: { role: true } }): Promise<{ role: string } | null>;
  };
};

/**
 * Check if user is admin (async, fetches from DB)
 */
export async function isAdmin(userId: string, prisma: RoleLookup): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  return user?.role === 'ADMIN';
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

type SettingsWithSecrets = {
  watchTowerPassword: string;
  tmdbApiKey: string;
  plexSettings: { token: string } | null;
};

/** Blank credentials before returning settings to a non-admin or anonymous caller. */
export function redactSettingsSecrets<T extends SettingsWithSecrets>(settings: T): T {
  return {
    ...settings,
    watchTowerPassword: '',
    tmdbApiKey: '',
    plexSettings: settings.plexSettings ? { ...settings.plexSettings, token: '' } : null,
  };
}
