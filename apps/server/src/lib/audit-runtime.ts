import { db } from './context';
import { createAudit, BATCH_SIZE } from './audit';
import { watchTowerLink } from './wt-link';
import { postSignedEvent } from './wt-signed-post';

/** The one audit recorder the server uses (real database, real WatchTower). */
export const audit = createAudit({
  store: {
    async insert(row) {
      await db.auditOutbox.create({ data: { eventId: row.eventId, payload: row.payload as object } });
    },
    async pending(limit) {
      return db.auditOutbox.findMany({ where: { sentAt: null }, orderBy: { createdAt: 'asc' }, take: limit ?? BATCH_SIZE });
    },
    async markSent(ids, at) {
      await db.auditOutbox.updateMany({ where: { id: { in: ids } }, data: { sentAt: at, lastError: null } });
    },
    async markFailed(rows, error) {
      for (const row of rows) {
        await db.auditOutbox.update({ where: { id: row.id }, data: { attempts: row.attempts + 1, lastError: error } });
      }
    },
    async pruneSent(before) {
      await db.auditOutbox.deleteMany({ where: { sentAt: { lt: before } } });
    },
  },
  link: watchTowerLink,
  post: (link, payload) => postSignedEvent(link, payload),
});

const FLUSH_EVERY_MS = 30_000;
let timer: NodeJS.Timeout | null = null;

/** Send waiting events every 30 seconds. Safe to call twice. */
export function startAuditFlusher(): void {
  if (timer) return;
  timer = setInterval(() => void audit.flush(), FLUSH_EVERY_MS);
  timer.unref?.();
}
