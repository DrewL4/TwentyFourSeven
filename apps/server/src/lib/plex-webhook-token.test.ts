import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_DAYS,
  PLEX_WEBHOOK_SETTING,
  checkPlexWebhookToken,
  getPlexWebhookStatus,
  notePlexWebhookCall,
  regeneratePlexWebhookToken,
  type PlexWebhookStore,
} from "./plex-webhook-token";

function memoryStore(plexCalls = 0) {
  const rows = new Map<string, string>();
  const store: PlexWebhookStore = {
    async get(k) { return rows.has(k) ? rows.get(k)! : null; },
    async setIfMissing(k, v) { if (!rows.has(k)) rows.set(k, v); return rows.get(k)!; },
    async set(k, v) { rows.set(k, v); },
    async countPlexActivity() { return plexCalls; },
  };
  return { store, rows };
}

const T0 = new Date("2026-10-25T12:00:00Z");
const later = (days: number) => new Date(T0.getTime() + days * 86_400_000);

test("new install: no token and wrong token are refused, right token passes", async () => {
  const { store } = memoryStore(0);
  assert.deepEqual(await checkPlexWebhookToken(null, store, T0), { ok: false, reason: "missing" });
  assert.deepEqual(await checkPlexWebhookToken("", store, T0), { ok: false, reason: "missing" });
  assert.deepEqual(await checkPlexWebhookToken("not-the-token", store, T0), { ok: false, reason: "wrong" });
  const { token, graceUntil } = await getPlexWebhookStatus(store, T0);
  assert.equal(graceUntil, null);
  assert.ok(token.length >= 32 && /^[A-Za-z0-9_-]+$/.test(token), "URL-safe random token");
  assert.deepEqual(await checkPlexWebhookToken(token, store, T0), { ok: true, via: "token" });
  assert.deepEqual(await checkPlexWebhookToken(token.slice(0, -1), store, T0), { ok: false, reason: "wrong" });
});

test("the token is made once and kept", async () => {
  const { store, rows } = memoryStore(0);
  const a = (await getPlexWebhookStatus(store, T0)).token;
  const b = (await getPlexWebhookStatus(store, T0)).token;
  assert.equal(a, b);
  assert.equal(rows.get(PLEX_WEBHOOK_SETTING.token), a);
  assert.notEqual((await getPlexWebhookStatus(memoryStore(0).store, T0)).token, a);
});

test("upgrade: the old URL keeps working during grace, a wrong token never does", async () => {
  const { store } = memoryStore(12);
  assert.deepEqual(await checkPlexWebhookToken(null, store, T0), { ok: true, via: "grace" });
  assert.deepEqual(await checkPlexWebhookToken("guess", store, T0), { ok: false, reason: "wrong" });
  const status = await getPlexWebhookStatus(store, T0);
  assert.equal(status.graceUntil, later(GRACE_DAYS).toISOString());
  assert.deepEqual(await checkPlexWebhookToken(null, store, later(GRACE_DAYS - 0.01)), { ok: true, via: "grace" });
  assert.deepEqual(await checkPlexWebhookToken(null, store, later(GRACE_DAYS)), { ok: false, reason: "missing" });
  assert.equal((await getPlexWebhookStatus(store, later(GRACE_DAYS))).graceUntil, null);
});

test("upgrade: the first call with the right token ends grace early", async () => {
  const { store } = memoryStore(3);
  const { token } = await getPlexWebhookStatus(store, T0);
  assert.deepEqual(await checkPlexWebhookToken(token, store, later(1)), { ok: true, via: "token" });
  assert.deepEqual(await checkPlexWebhookToken(null, store, later(1)), { ok: false, reason: "missing" });
  assert.equal((await getPlexWebhookStatus(store, later(1))).graceUntil, null);
});

test("regenerate: the old token and the no-token grace both stop working", async () => {
  const { store } = memoryStore(3);
  const old = (await getPlexWebhookStatus(store, T0)).token;
  const fresh = await regeneratePlexWebhookToken(store, T0);
  assert.notEqual(fresh.token, old);
  assert.equal(fresh.graceUntil, null);
  assert.deepEqual(await checkPlexWebhookToken(old, store, T0), { ok: false, reason: "wrong" });
  assert.deepEqual(await checkPlexWebhookToken(null, store, T0), { ok: false, reason: "missing" });
  assert.deepEqual(await checkPlexWebhookToken(fresh.token, store, T0), { ok: true, via: "token" });
});

test("refused and old-URL calls are noted for the admin page, at most once a minute, never with the token", async () => {
  const { store, rows } = memoryStore(3);
  const logs: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { logs.push(a.join(" ")); };
  try {
    const { token } = await getPlexWebhookStatus(store, T0);
    await notePlexWebhookCall(store, await checkPlexWebhookToken(null, store, T0), T0);
    await notePlexWebhookCall(store, { ok: false, reason: "wrong" }, T0);
    await notePlexWebhookCall(store, { ok: false, reason: "wrong" }, new Date(T0.getTime() + 1000));
    const status = await getPlexWebhookStatus(store, T0);
    assert.equal(status.lastOldUrlAt, T0.toISOString());
    assert.deepEqual(status.lastRefused, { at: T0.toISOString(), reason: "wrong" });
    assert.equal(logs.length, 2, "second wrong-token call within a minute is not logged again");
    for (const line of [...logs, ...rows.values()].filter((v) => v !== token)) assert.ok(!line.includes(token));
  } finally {
    console.warn = warn;
  }
});
