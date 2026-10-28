import type { NextRequest } from 'next/server';
import { usersTabDirectory } from '@/lib/users-tab-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return usersTabDirectory(request);
}
