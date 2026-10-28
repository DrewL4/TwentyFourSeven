import type { NextRequest } from 'next/server';
import { usersTabAction } from '@/lib/users-tab-route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return usersTabAction(request);
}
