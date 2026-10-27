import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asChanges,
  buildAuditPayload,
  createAudit,
  isReadProcedure,
  KEEP_SENT_MS,
  REDACTED,
  redact,
  type AuditStore,
  type OutboxRow,
} from './audit';

function memoryStore() {
  const rows: Array<OutboxRow & { sentAt: Date | null; lastError?: string }> = [];
  const pruned: Date[] = [];
  let failInsert = false;
  const store: AuditStore = {
    async insert(row) {
      if (failInsert) throw new Error('disk full');
      rows.push({ id: `r${rows.length + 1}`, eventId: row.eventId, payload: row.payload, attempts: 0, sentAt: null });
    },
    async pending(limit) {
      return rows.filter((r) => !r.sentAt).slice(0, limit);
    },
    async markSent(ids, at) {
      rows.filter((r) => ids.includes(r.id)).forEach((r) => (r.sentAt = at));
    },
    async markFailed(list, error) {
      list.forEach((l) => {
        const r = rows.find((x) => x.id === l.id)!;
        r.attempts += 1;
        r.lastError = error;
      });
    },
    async pruneSent(before) {
      pruned.push(before);
    },
  };
  return { store, rows, pruned, failInsert: (v: boolean) => (failInsert = v) };
}

describe('redact', () => {
  it('hides secret-looking fields at any depth, keeps the rest', () => {
    const out = redact({ name: 'Movies', plexToken: 'abc', nested: { webhookSecret: 'x', ok: 1 }, list: [{ password: 'p', a: 2 }], baseUrl: 'http://x', apiKey: 'k', loginName: 'l' }) as any;
    assert.equal(out.name, 'Movies');
    assert.equal(out.plexToken, REDACTED);
    assert.equal(out.nested.webhookSecret, REDACTED);
    assert.equal(out.nested.ok, 1);
    assert.equal(out.list[0].password, REDACTED);
    assert.equal(out.list[0].a, 2);
    assert.equal(out.baseUrl, REDACTED);
    assert.equal(out.apiKey, REDACTED);
    assert.equal(out.loginName, REDACTED);
  });
  it('shortens long text and caps field counts', () => {
    assert.equal((redact({ note: 'x'.repeat(500) }) as any).note.length, 203);
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`f${i}`, i]));
    assert.equal(Object.keys(redact(many) as object).length, 30);
  });
  it('asChanges wraps each field as before/after', () => {
    assert.deepEqual(asChanges({ name: 'A', token: 't' }), { name: { before: null, after: 'A' }, token: { before: null, after: REDACTED } });
    assert.deepEqual(asChanges('nope'), {});
  });
});

describe('buildAuditPayload', () => {
  it('has the shape WatchTower stores', () => {
    const p = buildAuditPayload(
      { action: 'channels.update', actor: { id: '42', name: 'Mo', role: 'manager' }, targetType: 'channels', targetId: 7, changes: { name: 'x' }, ip: '1.2.3.4', userAgent: 'UA' },
      new Date('2026-10-27T20:00:00Z'),
      'evt-1',
    );
    assert.deepEqual(p, {
      id: 'evt-1', occurred_at: '2026-10-27T20:00:00.000Z', action: 'channels.update', actor_id: 42, actor_name: 'Mo', actor_role: 'manager',
      target_type: 'channels', target_id: '7', target_label: '', changes: { name: 'x' }, result: 'ok', ip: '1.2.3.4', user_agent: 'UA', request_id: '',
    });
  });
  it('a non-numeric WatchTower id gives a null actor id', () => {
    assert.equal(buildAuditPayload({ action: 'a', actor: { id: 'abc' } }).actor_id, null);
    assert.equal(buildAuditPayload({ action: 'a' }).actor_id, null);
  });
});

describe('recorder and flusher', () => {
  const link = { url: 'http://wt.test', secret: 's3cret' };

  it('record never throws, even when the store fails', async () => {
    const m = memoryStore();
    m.failInsert(true);
    const a = createAudit({ store: m.store, link: async () => link, post: async () => ({ ok: true }), onError: () => {} });
    await assert.doesNotReject(a.record({ action: 'x' }));
    assert.equal(m.rows.length, 0);
  });

  it('flush sends one audit.batch and marks rows sent', async () => {
    const m = memoryStore();
    const posts: any[] = [];
    const a = createAudit({ store: m.store, link: async () => link, post: async (_l, body) => (posts.push(body), { ok: true }) });
    await a.record({ action: 'channels.update', actor: { id: '1', name: 'A', role: 'admin' } });
    await a.record({ action: 'channels.delete' });
    assert.deepEqual(await a.flush(), { sent: 2 });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].event_type, 'audit.batch');
    assert.deepEqual(posts[0].events.map((e: any) => e.action), ['channels.update', 'channels.delete']);
    assert.equal(m.rows.every((r) => r.sentAt), true);
    assert.deepEqual(await a.flush(), { sent: 0 });
    assert.equal(posts.length, 1);
  });

  it('a failed send keeps the rows and counts the attempt; a later flush retries', async () => {
    const m = memoryStore();
    let ok = false;
    const a = createAudit({ store: m.store, link: async () => link, post: async () => (ok ? { ok: true } : { ok: false, error: 'HTTP 502' }) });
    await a.record({ action: 'x' });
    assert.deepEqual(await a.flush(), { sent: 0, reason: 'HTTP 502' });
    assert.equal(m.rows[0].attempts, 1);
    assert.equal(m.rows[0].lastError, 'HTTP 502');
    ok = true;
    assert.deepEqual(await a.flush(), { sent: 1 });
  });

  it('nothing is sent while WatchTower is not configured, and nothing is lost', async () => {
    const m = memoryStore();
    let posted = 0;
    const a = createAudit({ store: m.store, link: async () => null, post: async () => (posted++, { ok: true }) });
    await a.record({ action: 'x' });
    assert.equal((await a.flush()).reason, 'WatchTower webhook not configured');
    assert.equal(posted, 0);
    assert.equal(m.rows[0].sentAt, null);
  });

  it('flush never throws and shares one run between callers', async () => {
    const m = memoryStore();
    let posts = 0;
    const a = createAudit({ store: m.store, link: async () => link, post: async () => (posts++, { ok: true }), onError: () => {} });
    await a.record({ action: 'x' });
    await Promise.all([a.flush(), a.flush()]);
    assert.equal(posts, 1);
    const broken = createAudit({ store: m.store, link: async () => { throw new Error('db'); }, post: async () => ({ ok: true }), onError: () => {} });
    assert.deepEqual(await broken.flush(), { sent: 0, reason: 'error' });
  });

  it('sent rows are pruned after a week', async () => {
    const m = memoryStore();
    const t = Date.parse('2026-10-27T20:00:00Z');
    const a = createAudit({ store: m.store, link: async () => link, post: async () => ({ ok: true }), now: () => t });
    await a.flush();
    assert.equal(m.pruned[0].getTime(), t - KEEP_SENT_MS);
  });
});

describe('isReadProcedure', () => {
  it('reads are not logged, writes are', () => {
    for (const p of [['channels', 'get'], ['servers', 'list'], ['settings', 'getStats'], ['viewers', 'listMappings'], ['franchises', 'previewChannelSort'], ['servers', 'testConnection'], ['settings', 'status']]) {
      assert.equal(isReadProcedure(p), true, p.join('.'));
    }
    for (const p of [['channels', 'update'], ['channels', 'delete'], ['servers', 'create'], ['settings', 'regenerateWebhookToken'], ['viewers', 'blockIp'], ['programming', 'maintain'], ['settings', 'clearActivity'], ['admin', 'watchtower', 'sync-users', 'post']]) {
      assert.equal(isReadProcedure(p), false, p.join('.'));
    }
  });
});
