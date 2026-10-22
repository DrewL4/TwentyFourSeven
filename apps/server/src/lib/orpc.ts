import { ORPCError, os } from "@orpc/server";
import type { Context } from "./context";
import { ADMIN_REQUIRED_MESSAGE, isAdmin } from "./admin-auth";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

// TFS roles come from WatchTower at sign-in (auth/watchtower/route.ts): WT admins
// are ADMIN, everyone else is USER (viewer: home, guide, watch). The role is read
// from the DB on every call so a WT demotion applies without a new session.
const requireAdmin = o.middleware(async ({ context, next }) => {
  const userId = context.session?.user?.id;
  if (!userId) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (!(await isAdmin(userId, context.db))) {
    throw new ORPCError("FORBIDDEN", { message: ADMIN_REQUIRED_MESSAGE });
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const adminProcedure = publicProcedure.use(requireAdmin);
