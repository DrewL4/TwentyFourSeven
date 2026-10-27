/**
 * Who may keep a TFS session. WatchTower decides roles and active status; when a
 * user is deactivated, deleted or demoted (any drop in role), every TFS session they have
 * is deleted so they are signed out everywhere (Drew's rule: demotion logs out).
 */

import { lostRankOrActive } from './wt-roles';

export type AccessState = { isActive: boolean; role: string };

type SessionStore = {
  session: { deleteMany(args: { where: { userId: string } }): Promise<unknown> };
};

type ActiveLookup = {
  user: {
    findUnique(args: { where: { id: string }; select: { isActive: true } }): Promise<{ isActive: boolean } | null>;
  };
};

/** Deactivated, or the role dropped a rank (ADMIN to MANAGER, MANAGER to USER, ADMIN to USER). */
export function lostAccess(before: AccessState, after: AccessState): boolean {
  return lostRankOrActive(before, after);
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
