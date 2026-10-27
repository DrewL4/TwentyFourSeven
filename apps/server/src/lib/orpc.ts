import { ORPCError, os } from "@orpc/server";
import type { Context } from "./context";
import {
  ADMIN_REQUIRED_MESSAGE,
  MANAGER_REQUIRED_MESSAGE,
  getEffectiveRole,
} from "./admin-auth";
import { isActiveUser } from "./user-access";
import { auditProcedureCall } from "./orpc-audit";
import { roleRank, type TfsRole } from "./wt-roles";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  const userId = context.session?.user?.id;
  // Deactivated users are signed out: an old session cookie is not enough.
  if (!userId || !(await isActiveUser(userId, context.db))) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * Roles come from WatchTower (owner/admin = ADMIN, manager = MANAGER, everyone else USER).
 * The role is read on every call and re-checked with WatchTower every 5 minutes, failing
 * closed, so a demotion applies without a new session.
 *
 * A Manager or Admin call that changes something, and any refused attempt by a signed-in
 * user, goes to the audit outbox.
 */
function requireRole(needed: TfsRole, message: string) {
  return o.middleware(async ({ context, next, path }, input) => {
    const userId = context.session?.user?.id;
    if (!userId || !(await isActiveUser(userId, context.db))) {
      throw new ORPCError("UNAUTHORIZED");
    }
    const role = await getEffectiveRole(userId, context.db);
    const call = { userId, role, db: context.db, path, input, ip: context.ip, userAgent: context.userAgent };
    if (roleRank(role) < roleRank(needed)) {
      await auditProcedureCall({ ...call, result: "denied" });
      throw new ORPCError("FORBIDDEN", { message });
    }
    const output = await next({
      context: {
        session: context.session,
      },
    });
    await auditProcedureCall({ ...call, result: "ok" });
    return output;
  });
}

/** Admin only: users, viewers, settings, sources, integrations. */
export const adminProcedure = publicProcedure.use(requireRole("ADMIN", ADMIN_REQUIRED_MESSAGE));

/** Manager or Admin: channels, franchises, programming (EPG) and the library page. */
export const managerProcedure = publicProcedure.use(requireRole("MANAGER", MANAGER_REQUIRED_MESSAGE));
