import type { NextRequest } from 'next/server';
import { usersTabUserPageSave } from '@/lib/users-tab-route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return usersTabUserPageSave(request, id);
}
