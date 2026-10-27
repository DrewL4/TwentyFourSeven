import { db } from './context';
import { createRoleChecker } from './wt-roles';
import { WatchTowerHubService } from './watchtower-hub-service';
import { signOutEverywhere } from './user-access';

const hub = WatchTowerHubService.getInstance();

/** The one role checker the server uses (real database, real WatchTower). */
export const roleChecker = createRoleChecker({
  fetchWtUser: (id) => hub.fetchUserById(id),
  isLinked: () => hub.isConfigured(),
  save: async (userId, data) => {
    await db.user.update({ where: { id: userId }, data: { ...data, updatedAt: new Date() } });
  },
  signOut: (userId) => signOutEverywhere(db, userId),
  now: Date.now,
});
