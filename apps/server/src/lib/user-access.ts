/**
 * Who may keep a TFS session. WatchTower decides roles and active status; when a
 * user is deactivated, deleted or demoted from ADMIN, every TFS session they have
 * is deleted so they are signed out everywhere (Drew's rule: demotion logs out).
 */

export type AccessState = { isActive: boolean; role: string };

type SessionStore = {
  session: { deleteMany(args: { where: { userId: string } }): Promise<unknown> };
};

type ActiveLookup = {
  user: {
    findUnique(args: { where: { id: string }; select: { isActive: true } }): Promise<{ isActive: boolean } | null>;
  };
};

export function lostAccess(before: AccessState, after: AccessState): boolean {
  return (before.isActive && !after.isActive) || (before.role === 'ADMIN' && after.role !== 'ADMIN');
}

export async function signOutEverywhere(db: SessionStore, userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

/** Delete the user's sessions when this change took access away. Returns true if it did. */
export async function signOutIfLostAccess(
  db: SessionStore,
  userId: string,
  before: AccessState,
  after: AccessState
): Promise<boolean> {
  if (!lostAccess(before, after)) return false;
  await signOutEverywhere(db, userId);
  return true;
}

/** A session only counts while its user exists and is active. */
export async function isActiveUser(userId: string, db: ActiveLookup): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  return !!user?.isActive;
}
