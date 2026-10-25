import { randomBytes } from "node:crypto";
import { integrationTokenMatches } from "./integration-token";

/**
 * Plex webhooks cannot send headers, so /api/plex/webhook is protected by a
 * secret in its URL (`?token=`). The secret is made on the server the first
 * time it is needed and kept in the `setting` table like the WatchTower secret.
 *
 * Rollout: an install that already received Plex webhooks keeps accepting
 * calls WITHOUT a token for GRACE_DAYS, so the URL already saved in Plex keeps
 * working while the admin page asks for the new one. The grace ends early the
 * first time Plex calls with the right token, or when the token is regenerated.
 * A wrong token is always refused. New installs get no grace.
 */

export const PLEX_WEBHOOK_SETTING = {
  token: "plex_webhook_token",
  /** ISO date while grace is on; "none" once it is over or never applied. */
  graceUntil: "plex_webhook_grace_until",
  /** ISO date of the last call that came in on the old URL during grace. */
  lastOldUrlAt: "plex_webhook_last_old_url_at",
  /** JSON {at, reason} of the last refused call. */
  lastRefused: "plex_webhook_last_refused",
} as const;

export const GRACE_DAYS = 7;
const NOTE_EVERY_MS = 60_000;

export interface PlexWebhookStore {
  get(key: string): Promise<string | null>;
  /** Stores `value` only if `key` has no value yet; returns what is stored. */
  setIfMissing(key: string, value: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
  /** How many Plex webhook calls were recorded before tokens existed. */
  countPlexActivity(): Promise<number>;
}

export type PlexWebhookGate =
  | { ok: true; via: "token" | "grace" }
  | { ok: false; reason: "missing" | "wrong" };

export interface PlexWebhookStatus {
  token: string;
  graceUntil: string | null;
  lastOldUrlAt: string | null;
  lastRefused: { at: string; reason: "missing" | "wrong" } | null;
}

export function newPlexWebhookToken(): string {
  return randomBytes(24).toString("base64url");
}

function activeGrace(value: string | null, now: Date): Date | null {
  if (!value || value === "none") return null;
  const until = new Date(value);
  return Number.isFinite(until.getTime()) && until > now ? until : null;
}

/** Returns the token, creating it (and deciding the grace window) on first use. */
export async function ensurePlexWebhookToken(store: PlexWebhookStore, now = new Date()): Promise<string> {
  const existing = await store.get(PLEX_WEBHOOK_SETTING.token);
  if (existing) return existing;
  // Grace is decided before the token exists, so a call racing the first
  // token never sees a token without its grace setting.
  const hadCalls = (await store.countPlexActivity()) > 0;
  const until = new Date(now.getTime() + GRACE_DAYS * 86_400_000).toISOString();
  await store.setIfMissing(PLEX_WEBHOOK_SETTING.graceUntil, hadCalls ? until : "none");
  return store.setIfMissing(PLEX_WEBHOOK_SETTING.token, newPlexWebhookToken());
}

export async function checkPlexWebhookToken(
  presented: string | null,
  store: PlexWebhookStore,
  now = new Date(),
): Promise<PlexWebhookGate> {
  const token = await ensurePlexWebhookToken(store, now);
  if (presented) {
    if (!integrationTokenMatches(presented, token)) return { ok: false, reason: "wrong" };
    if (activeGrace(await store.get(PLEX_WEBHOOK_SETTING.graceUntil), now)) {
      await store.set(PLEX_WEBHOOK_SETTING.graceUntil, "none");
      console.log("[plex-webhook] Plex is using the new webhook URL; calls without the token are now refused");
    }
    return { ok: true, via: "token" };
  }
  if (activeGrace(await store.get(PLEX_WEBHOOK_SETTING.graceUntil), now)) return { ok: true, via: "grace" };
  return { ok: false, reason: "missing" };
}

const lastNote = new Map<string, number>();

/** Writes at most one note per kind per minute, so floods of bad calls do not turn into DB writes or log spam. */
export async function notePlexWebhookCall(
  store: PlexWebhookStore,
  gate: PlexWebhookGate,
  now = new Date(),
): Promise<void> {
  if (gate.ok && gate.via === "token") return;
  const kind = gate.ok ? "grace" : gate.reason;
  const last = lastNote.get(kind) ?? 0;
  if (now.getTime() - last < NOTE_EVERY_MS) return;
  lastNote.set(kind, now.getTime());
  const at = now.toISOString();
  if (gate.ok) {
    const until = await store.get(PLEX_WEBHOOK_SETTING.graceUntil);
    console.warn(`[plex-webhook] Accepted a call without the webhook token (old URL). This stops on ${until}; copy the new URL from Settings > Plex into Plex.`);
    await store.set(PLEX_WEBHOOK_SETTING.lastOldUrlAt, at);
  } else {
    console.warn(`[plex-webhook] Refused a call: ${gate.reason === "missing" ? "no token" : "wrong token"} in the webhook URL`);
    await store.set(PLEX_WEBHOOK_SETTING.lastRefused, JSON.stringify({ at, reason: gate.reason }));
  }
}

export async function getPlexWebhookStatus(store: PlexWebhookStore, now = new Date()): Promise<PlexWebhookStatus> {
  const token = await ensurePlexWebhookToken(store, now);
  const grace = activeGrace(await store.get(PLEX_WEBHOOK_SETTING.graceUntil), now);
  let lastRefused: PlexWebhookStatus["lastRefused"] = null;
  try {
    const raw = await store.get(PLEX_WEBHOOK_SETTING.lastRefused);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.at && (parsed.reason === "missing" || parsed.reason === "wrong")) lastRefused = parsed;
  } catch {
    lastRefused = null;
  }
  return {
    token,
    graceUntil: grace ? grace.toISOString() : null,
    lastOldUrlAt: (await store.get(PLEX_WEBHOOK_SETTING.lastOldUrlAt)) || null,
    lastRefused,
  };
}

/** New token; the old URL (with or without a token) stops working at once. */
export async function regeneratePlexWebhookToken(store: PlexWebhookStore, now = new Date()): Promise<PlexWebhookStatus> {
  await store.set(PLEX_WEBHOOK_SETTING.graceUntil, "none");
  await store.set(PLEX_WEBHOOK_SETTING.token, newPlexWebhookToken());
  await store.set(PLEX_WEBHOOK_SETTING.lastOldUrlAt, "");
  await store.set(PLEX_WEBHOOK_SETTING.lastRefused, "");
  return getPlexWebhookStatus(store, now);
}

/** The real store: `setting` rows plus the webhook activity count. */
export function prismaPlexWebhookStore(): PlexWebhookStore {
  const db = async () => (await import("./prisma")).prisma;
  return {
    async get(key) {
      const row = await (await db()).setting.findUnique({ where: { key } });
      return row?.value ?? null;
    },
    async setIfMissing(key, value) {
      const prisma = await db();
      try {
        return (await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} })).value;
      } catch {
        // Lost a race with another first call: keep the winner's value.
        const row = await prisma.setting.findUnique({ where: { key } });
        if (row) return row.value;
        throw new Error(`could not store ${key}`);
      }
    },
    async set(key, value) {
      await (await db()).setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    },
    async countPlexActivity() {
      return (await db()).webhookActivity.count({ where: { source: "plex" } });
    },
  };
}
