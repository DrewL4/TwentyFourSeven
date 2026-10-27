import { randomUUID } from 'node:crypto';
import type { WatchTowerLink, PostResult } from './wt-signed-post';

/**
 * Audit events for WatchTower's Activity page.
 *
 * `record` writes to a local outbox and never throws: a logging problem must not break the
 * action being logged. `flush` sends the waiting rows as one signed `audit.batch`.
 * Secrets are replaced before anything is stored (same denylist as ESPG).
 */

export const REDACT_PATTERN = /password|token|secret|key|cookie|auth|credential|login|url/i;
export const REDACTED = '(hidden)';
export const MAX_VALUE_LENGTH = 200;
export const MAX_FIELDS = 30;
export const BATCH_SIZE = 100;
export const KEEP_SENT_MS = 7 * 24 * 60 * 60 * 1000;

export function redact(value: unknown, field = '', depth = 0): unknown {
  if (field && REDACT_PATTERN.test(field)) return REDACTED;
  if (depth > 6) return '(too deep)';
  if (Array.isArray(value)) return value.slice(0, MAX_FIELDS).map((v) => redact(v, '', depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_FIELDS)) {
      out[k] = redact(v, k, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) return `${value.slice(0, MAX_VALUE_LENGTH)}...`;
  if (typeof value === 'bigint') return String(value);
  return value;
}

/** WatchTower's Activity page shows `{field: {before, after}}`; the app only knows what was asked for. */
export function asChanges(input: unknown): Record<string, { before: null; after: unknown }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const clean = redact(input) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, { before: null, after: v }]));
}

export type AuditActor = { id?: string | null; name?: string; role?: string };
export type AuditInput = {
  action: string;
  actor?: AuditActor | null;
  targetType?: string;
  targetId?: string | number | null;
  targetLabel?: string;
  changes?: Record<string, unknown>;
  result?: 'ok' | 'denied';
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type AuditPayload = {
  id: string;
  occurred_at: string;
  action: string;
  actor_id: number | null;
  actor_name: string;
  actor_role: string;
  target_type: string;
  target_id: string;
  target_label: string;
  changes: unknown;
  result: 'ok' | 'denied';
  ip: string;
  user_agent: string;
  request_id: string;
};

export function buildAuditPayload(input: AuditInput, now: Date = new Date(), id: string = randomUUID()): AuditPayload {
  const wtId = String(input.actor?.id ?? '');
  return {
    id,
    occurred_at: now.toISOString(),
    action: input.action.slice(0, 100),
    actor_id: /^\d+$/.test(wtId) ? Number(wtId) : null,
    actor_name: (input.actor?.name ?? '').slice(0, 150),
    actor_role: (input.actor?.role ?? '').slice(0, 10),
    target_type: (input.targetType ?? '').slice(0, 50),
    target_id: String(input.targetId ?? '').slice(0, 100),
    target_label: (input.targetLabel ?? '').slice(0, 200),
    changes: redact(input.changes ?? {}),
    result: input.result ?? 'ok',
    ip: (input.ip ?? '').slice(0, 64),
    user_agent: (input.userAgent ?? '').slice(0, 200),
    request_id: (input.requestId ?? '').slice(0, 64),
  };
}

export type OutboxRow = { id: string; eventId: string; payload: unknown; attempts: number };

export type AuditStore = {
  insert(row: { eventId: string; payload: unknown }): Promise<void>;
  pending(limit: number): Promise<OutboxRow[]>;
  markSent(ids: string[], at: Date): Promise<void>;
  markFailed(rows: OutboxRow[], error: string): Promise<void>;
  pruneSent(before: Date): Promise<void>;
};

export type AuditDeps = {
  store: AuditStore;
  link: () => Promise<WatchTowerLink | null>;
  post: (link: WatchTowerLink, payload: unknown) => Promise<PostResult>;
  now?: () => number;
  onError?: (message: string, error: unknown) => void;
};

export function createAudit(deps: AuditDeps) {
  const now = deps.now ?? Date.now;
  const report = deps.onError ?? ((m, e) => console.warn(`[audit] ${m}:`, e instanceof Error ? e.name : e));
  let flushing: Promise<{ sent: number; reason?: string }> | null = null;

  async function record(input: AuditInput): Promise<void> {
    try {
      const payload = buildAuditPayload(input, new Date(now()));
      await deps.store.insert({ eventId: payload.id, payload });
    } catch (error) {
      report(`could not record ${input.action}`, error);
    }
  }

  async function runFlush(): Promise<{ sent: number; reason?: string }> {
    await deps.store.pruneSent(new Date(now() - KEEP_SENT_MS));
    const link = await deps.link();
    if (!link) return { sent: 0, reason: 'WatchTower webhook not configured' };
    const rows = await deps.store.pending(BATCH_SIZE);
    if (rows.length === 0) return { sent: 0 };
    const result = await deps.post(link, { event_type: 'audit.batch', events: rows.map((r) => r.payload) });
    if (result.ok) {
      await deps.store.markSent(rows.map((r) => r.id), new Date(now()));
      return { sent: rows.length };
    }
    await deps.store.markFailed(rows, result.error ?? 'error');
    return { sent: 0, reason: result.error ?? 'error' };
  }

  /** One flush at a time; never throws. */
  function flush(): Promise<{ sent: number; reason?: string }> {
    if (!flushing) {
      flushing = runFlush()
        .catch((error) => {
          report('flush failed', error);
          return { sent: 0, reason: 'error' };
        })
        .finally(() => {
          flushing = null;
        });
    }
    return flushing;
  }

  return { record, flush };
}

/** Writes that change something. Reads (get/list/search/...) are not logged. */
const READ_NAME = /^(get|list|search|find|preview|status|stats|settings|espg|mine|browse|detect|validate|check|systemInfo|webhookAccess|test|suggest|current|channel|m3u|xmltv|isAvailable)/i;
export function isReadProcedure(path: readonly string[]): boolean {
  return READ_NAME.test(path[path.length - 1] ?? '');
}
