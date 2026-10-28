import type { NextRequest } from 'next/server';
import { usersTabUserPage } from '@/lib/users-tab-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return usersTabUserPage(request, id);
}
