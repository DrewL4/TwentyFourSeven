import { asChanges, isReadProcedure, type AuditInput } from './audit';
import type { TfsRole } from './wt-roles';

export type AuditSink = (input: AuditInput) => Promise<void>;
let sinkOverride: AuditSink | null = null;

/** Tests swap the sink; production uses the outbox (loaded on first use). */
export function setAuditSink(sink: AuditSink | null): void {
  sinkOverride = sink;
}

async function sink(input: AuditInput): Promise<void> {
  if (sinkOverride) return sinkOverride(input);
  const { audit } = await import('./audit-runtime');
  return audit.record(input);
}

type Db = { user: { findUnique(args: any): Promise<any> } };

export type CallInfo = {
  userId: string;
  role: TfsRole;
  db: Db;
  path: readonly string[];
  input: unknown;
  result: 'ok' | 'denied';
  ip?: string;
  userAgent?: string;
};

/**
 * Log a Manager/Admin call that changes something, and any refused attempt by a signed-in user.
 * Never throws and never delays the caller beyond one local insert.
 */
export async function auditProcedureCall(call: CallInfo): Promise<void> {
  try {
    if (call.result === 'ok' && isReadProcedure(call.path)) return;
    const row = await call.db.user.findUnique({
      where: { id: call.userId },
      select: { name: true, email: true, watchTowerUserId: true },
    });
    const input = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<string, unknown>;
    const targetId = input.id ?? input.channelId ?? input.serverId ?? input.franchiseId ?? input.userId ?? '';
    await sink({
      action: call.path.join('.'),
      actor: { id: row?.watchTowerUserId ?? null, name: row?.name || row?.email || call.userId, role: call.role.toLowerCase() },
      targetType: call.path[0] ?? '',
      targetId: typeof targetId === 'object' ? '' : (targetId as string | number),
      changes: asChanges(input),
      result: call.result,
      ip: call.ip,
      userAgent: call.userAgent,
    });
  } catch (error) {
    console.warn('[audit] could not log call:', error instanceof Error ? error.name : error);
  }
}

/** Managers and Admins signing in are always logged. */
export async function auditElevatedLogin(opts: { userId: string; role: TfsRole; db: Db; method: string; ip?: string; userAgent?: string }): Promise<void> {
  if (opts.role !== 'ADMIN' && opts.role !== 'MANAGER') return;
  try {
    const row = await opts.db.user.findUnique({ where: { id: opts.userId }, select: { name: true, email: true, watchTowerUserId: true } });
    await sink({
      action: 'auth.login',
      actor: { id: row?.watchTowerUserId ?? null, name: row?.name || row?.email || opts.userId, role: opts.role.toLowerCase() },
      targetType: 'user',
      targetId: opts.userId,
      targetLabel: row?.email ?? '',
      changes: { method: { before: null, after: opts.method } },
      ip: opts.ip,
      userAgent: opts.userAgent,
    });
  } catch (error) {
    console.warn('[audit] could not log login:', error instanceof Error ? error.name : error);
  }
}
