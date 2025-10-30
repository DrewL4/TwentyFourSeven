import type { Context } from './context';

/**
 * Require admin role, throw error if user is not admin
 */
export function requireAdmin(context: Context): void {
  if (!context.session?.user?.id) {
    throw new Error('Unauthorized');
  }

  // Check if user is admin
  // Note: This will need to fetch user from DB to check role
  // For now, we'll check this in the handler
}

/**
 * Check if user is admin (async, fetches from DB)
 */
export async function isAdmin(userId: string, prisma: any): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  return user?.role === 'ADMIN';
}

/**
 * Require admin role (async version)
 */
export async function requireAdminAsync(
  userId: string | undefined,
  prisma: any
): Promise<void> {
  if (!userId) {
    throw new Error('Unauthorized');
  }

  const admin = await isAdmin(userId, prisma);
  if (!admin) {
    throw new Error('Admin access required');
  }
}

