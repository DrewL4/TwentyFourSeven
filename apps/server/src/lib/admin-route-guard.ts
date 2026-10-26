import { NextResponse, type NextRequest } from 'next/server';
import { auth } from './auth';
import { prisma } from './prisma';
import { ADMIN_REQUIRED_MESSAGE, isAdmin } from './admin-auth';
import { isActiveUser } from './user-access';

type GuardOptions = {
  /** First-run bootstrap: allow the call while TFS has no users at all. */
  allowWhenNoUsers?: boolean;
};

/**
 * Admin gate for Next API routes under /api/admin. Returns a 401/403 response to
 * send back, or null when the caller may proceed.
 */
export async function guardAdminRoute(
  request: NextRequest,
  options: GuardOptions = {}
): Promise<NextResponse | null> {
  if (options.allowWhenNoUsers && (await prisma.user.count()) === 0) {
    return null;
  }

  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId || !(await isActiveUser(userId, prisma))) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  if (!(await isAdmin(userId, prisma))) {
    return NextResponse.json({ error: ADMIN_REQUIRED_MESSAGE }, { status: 403 });
  }
  return null;
}
