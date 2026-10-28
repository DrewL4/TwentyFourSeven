import { NextResponse, type NextRequest } from 'next/server';
import { auth } from './auth';
import { prisma } from './prisma';
import { isActiveUser } from './user-access';
import { watchTowerLink } from './wt-link';
import { callUsersTab, isUsersTabAction, type UsersTabAction } from './users-tab-proxy';

/** The signed-in, active person making this request, with their WatchTower id. null when not signed in. */
async function currentCaller(request: NextRequest): Promise<{ watchTowerUserId: string | null } | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId || !(await isActiveUser(userId, prisma))) return null;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { watchTowerUserId: true } });
  return { watchTowerUserId: row?.watchTowerUserId ?? null };
}

const noStore = { 'Cache-Control': 'no-store' };

/** GET: WatchTower's Users directory as the signed-in person is allowed to see it. */
export async function usersTabDirectory(request: NextRequest): Promise<NextResponse> {
  const caller = await currentCaller(request);
  if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: noStore });
  const result = await callUsersTab(caller, 'list', {}, { link: watchTowerLink });
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}

/** POST: one Users tab action. WatchTower decides whether this person may do it. */
export async function usersTabAction(request: NextRequest): Promise<NextResponse> {
  const caller = await currentCaller(request);
  if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: noStore });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    body = {};
  }
  const { action, ...args } = body;
  if (!isUsersTabAction(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400, headers: noStore });
  }
  const result = await callUsersTab(caller, action as UsersTabAction, args, { link: watchTowerLink });
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}

/** GET: one person's page (WatchTower builds it from its own data and from ESPG and 24/7). */
export async function usersTabUserPage(request: NextRequest, userId: string): Promise<NextResponse> {
  const caller = await currentCaller(request);
  if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: noStore });
  if (!/^\d+$/.test(userId)) return NextResponse.json({ error: 'Unknown person.' }, { status: 404, headers: noStore });
  const result = await callUsersTab(caller, 'user_page', { user_id: Number(userId) }, { link: watchTowerLink });
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}

/** POST: save every changed part of the page together. WatchTower checks and applies each part. */
export async function usersTabUserPageSave(request: NextRequest, userId: string): Promise<NextResponse> {
  const caller = await currentCaller(request);
  if (!caller) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: noStore });
  if (!/^\d+$/.test(userId)) return NextResponse.json({ error: 'Unknown person.' }, { status: 404, headers: noStore });
  let changes: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed.changes === 'object' && parsed.changes && !Array.isArray(parsed.changes)) changes = parsed.changes;
  } catch {
    changes = {};
  }
  const result = await callUsersTab(caller, 'user_page_save', { user_id: Number(userId), changes }, { link: watchTowerLink });
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}
