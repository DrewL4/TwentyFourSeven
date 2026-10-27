import { NextResponse, type NextRequest } from 'next/server';
import { auth } from './auth';
import { prisma } from './prisma';
import { ADMIN_REQUIRED_MESSAGE, getEffectiveRole } from './admin-auth';
import { auditProcedureCall } from './orpc-audit';
import { clientAddress } from './link-security';
import { roleRank } from './wt-roles';
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
  const role = await getEffectiveRole(userId, prisma);
  // /api/admin/watchtower/foo -> admin.watchtower.foo (the same naming the app's own calls use)
  const path = new URL(request.url).pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const call = {
    userId,
    role,
    db: prisma,
    path: [...path, ...(request.method === 'GET' || request.method === 'HEAD' ? [] : [request.method.toLowerCase()])].slice(0, 6),
    input: {},
    ip: clientAddress(request.headers),
    userAgent: (request.headers.get('user-agent') || '').slice(0, 200),
  };
  if (roleRank(role) < roleRank('ADMIN')) {
    await auditProcedureCall({ ...call, result: 'denied' });
    return NextResponse.json({ error: ADMIN_REQUIRED_MESSAGE }, { status: 403 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    await auditProcedureCall({ ...call, result: 'ok' });
  }
  return null;
}
