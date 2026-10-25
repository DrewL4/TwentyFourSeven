import { randomUUID } from "crypto";
import { prisma as defaultPrisma } from "./prisma";

export type ImportUserInput = {
  name?: string | null;
  email: string;
  firstName?: unknown;
  lastName?: unknown;
  emailVerified?: boolean | null;
  originalJoinDate?: string | Date | null;
};

/**
 * Create or update a TV user from WatchTower data. Shared by POST /api/admin/import-user
 * and the scheduled WatchTower sync, which used to POST to that route with a relative
 * URL (server-side fetch rejects it, so every user was counted as skipped).
 */
export async function importWatchTowerUser(input: ImportUserInput, db: typeof defaultPrisma = defaultPrisma) {
  const { name, email, emailVerified, originalJoinDate } = input;
  const firstName = typeof input.firstName === "string" && input.firstName.trim() ? input.firstName.trim() : null;
  const lastName = typeof input.lastName === "string" && input.lastName.trim() ? input.lastName.trim() : null;

  const existingUser = await db.user.findUnique({ where: { email } });
  const now = new Date();
  let user;

  if (existingUser) {
    const updateData: any = {
      name: name || existingUser.name, // Keep existing name if new one is empty
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      emailVerified: emailVerified || existingUser.emailVerified,
      updatedAt: now,
      // Note: Don't update createdAt - preserve original creation date
    };
    // Update watchTowerJoinDate if provided and not already set
    if (originalJoinDate && !existingUser.watchTowerJoinDate) {
      updateData.watchTowerJoinDate = new Date(originalJoinDate);
    }
    user = await db.user.update({ where: { email }, data: updateData });
  } else {
    // Use original join date from WatchTower if provided, otherwise use current time
    const joinDate = originalJoinDate ? new Date(originalJoinDate) : now;
    user = await db.user.create({
      data: {
        id: randomUUID(),
        name: name as string,
        email,
        firstName,
        lastName,
        emailVerified: emailVerified || false,
        createdAt: joinDate,
        updatedAt: now,
        watchTowerJoinDate: originalJoinDate ? new Date(originalJoinDate) : null,
        // Note: No password is set - user will need to use "forgot password" to set one
      },
    });
  }

  try {
    const { emitUserUpdate } = await import("./socket-io");
    emitUserUpdate(email, existingUser ? "updated" : "created");
  } catch {
    // Socket.io may not be initialized
  }

  return { action: (existingUser ? "updated" : "created") as "updated" | "created", user };
}
