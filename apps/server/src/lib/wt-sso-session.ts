import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { signOutIfLostAccess, type AccessState } from '@/lib/user-access';

/**
 * WatchTower sign-in for a user TFS already knows.
 *
 * Before: the user row was deleted and recreated on every sign-in, which also deleted
 * every session the user had, so a phone sign-in signed the TV out (and the user id changed).
 * Now: the user row stays, a fresh throw-away password is set on the credential account, and
 * Better Auth issues one NEW session. The user's other sessions are left alone, so each device
 * keeps its own. A drop in role or active status still ends every session (signOutIfLostAccess).
 */
export async function startSessionForExistingUser(args: {
  userId: string;
  before: AccessState;
  after: AccessState;
}): Promise<{ tempPassword: string; signedOutEverywhere: boolean }> {
  const signedOutEverywhere = await signOutIfLostAccess(prisma, args.userId, args.before, args.after);

  const ctx = await auth.$context;
  const tempPassword = crypto.randomBytes(16).toString('hex');
  const hash = await ctx.password.hash(tempPassword);
  const credential = await prisma.account.findFirst({
    where: { userId: args.userId, providerId: 'credential' },
    select: { id: true },
  });
  if (credential) {
    await prisma.account.update({ where: { id: credential.id }, data: { password: hash, updatedAt: new Date() } });
  } else {
    await ctx.internalAdapter.linkAccount({
      userId: args.userId,
      providerId: 'credential',
      accountId: args.userId,
      password: hash,
    });
  }
  return { tempPassword, signedOutEverywhere };
}
