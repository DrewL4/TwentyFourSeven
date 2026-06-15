import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/context';
import { WatchTowerHubService } from '@/lib/watchtower-hub-service';

function extractToken(request: NextRequest): string | null {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Token ')) return auth.slice(6).trim();
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function shouldHaveMovieAccess(userData: Record<string, unknown>): boolean {
  if (userData.is_admin || userData.is_family) return true;
  if (!userData.is_active) return false;
  if (!userData.movie_service && !userData.is_movie_user) return false;
  if (!userData.movie_donation_due) return false;
  const due = new Date(String(userData.movie_donation_due));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due >= today;
}

// POST /api/admin/watchtower/reconcile
export async function POST(request: NextRequest) {
  const token = extractToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Token authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const users = (body.users || []) as Record<string, unknown>[];
    const hub = WatchTowerHubService.getInstance();
    let created = 0;
    let updated = 0;
    let deactivated = 0;
    const seenIds = new Set<string>();

    for (const userData of users) {
      const wtId = String(userData.user_id || userData.id || '');
      if (wtId) seenIds.add(wtId);

      const hasAccess = shouldHaveMovieAccess(userData);
      const email = String(userData.email || '');

      const existing = await db.user.findFirst({
        where: {
          OR: [
            { email },
            { watchTowerUserId: wtId || undefined },
          ],
        },
      });

      if (hasAccess) {
        await hub.handleWebhookEvent({
          event_type: existing ? 'user.updated' : 'user.created',
          timestamp: new Date().toISOString(),
          data: userData,
        });
        if (existing) updated += 1;
        else created += 1;
      } else if (existing) {
        await db.user.update({
          where: { id: existing.id },
          data: { isActive: false, updatedAt: new Date() },
        });
        const { emitUserUpdate } = await import('@/lib/socket-io');
        emitUserUpdate(existing.email, 'updated');
        deactivated += 1;
      }
    }

    const orphans = await db.user.findMany({
      where: {
        watchTowerUserId: { not: null },
        NOT: { watchTowerUserId: { in: [...seenIds] } },
      },
    });

    for (const orphan of orphans) {
      await db.user.update({
        where: { id: orphan.id },
        data: { isActive: false, updatedAt: new Date() },
      });
      const { emitUserUpdate } = await import('@/lib/socket-io');
      emitUserUpdate(orphan.email, 'updated');
      deactivated += 1;
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      deactivated,
      total: users.length,
    });
  } catch (error) {
    console.error('reconcile error:', error);
    return NextResponse.json({ error: 'Reconcile failed' }, { status: 500 });
  }
}
