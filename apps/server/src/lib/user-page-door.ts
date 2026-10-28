/**
 * The 24/7 part of WatchTower's per-user page: a signed door with get, validate and apply.
 *
 * WatchTower has already checked the signature (the webhook route does that) and decides what the person
 * who is acting may do; it sends that as `caps`. This module never grants more than the caps say, refuses
 * stale or repeated calls, and has no database code of its own: it talks to a `UserPageStore`.
 */

export const USER_PAGE_EVENT = 'user_page';
export const TIMESTAMP_WINDOW_MS = 300_000;
export const NONCE_TTL_MS = 600_000;
export const MAX_STREAMS_LIMIT = 50;

export type DoorReply = { status: number; body: Record<string, unknown> };

export type PageCaps = { edit: boolean };

export type PageUser = { id: string; email: string };

export type StreamLimit = {
  has_login: boolean;
  max_streams: number | null;
  username: string | null;
  /** True while the limit follows ESPG's TV connections (the number here is not used). */
  linked: boolean;
  /** Only when 24/7 keeps its own limit. */
  editable: boolean;
};

export type PageData = {
  user: { id: string; email: string; created_at: string | null; last_login: string | null };
  stream_limit: StreamLimit;
  franchises: { id: string; name: string; entry_count: number; channels: { id: string; number: number; name: string }[] }[];
  recent_viewing: {
    id: string;
    at: string | null;
    channel_number: number;
    channel: string;
    program: string;
    duration_seconds: number | null;
  }[];
};

export type UserPageStore = {
  findUser(target: { wtId: string; email: string }): Promise<PageUser | null>;
  read(user: PageUser): Promise<PageData>;
  streamLimit(user: PageUser): Promise<StreamLimit>;
  setMaxStreams(user: PageUser, value: number): Promise<void>;
};

export type NonceStore = { add(nonce: string, now: number): boolean };

export type DoorDeps = { store: UserPageStore; nonces: NonceStore; now?: () => number };

class DoorError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly errors: Record<string, string> = {},
  ) {
    super(message);
  }
}

const ACTIONS = ['get', 'validate', 'apply'] as const;
type Action = (typeof ACTIONS)[number];

/** Single-use nonces kept for NONCE_TTL_MS. A repeated nonce is refused (replay). */
export function createNonceStore(max = 5000): NonceStore {
  const seen = new Map<string, number>();
  return {
    add(nonce, now) {
      for (const [key, at] of seen) {
        if (now - at >= NONCE_TTL_MS) seen.delete(key);
        else break;
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, now);
      while (seen.size > max) {
        const oldest = seen.keys().next().value;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
      return true;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function capsFrom(payload: Record<string, unknown>): PageCaps {
  const raw = isRecord(payload.caps) ? payload.caps : {};
  return { edit: raw.edit === true };
}

function checkFresh(payload: Record<string, unknown>, deps: DoorDeps) {
  const now = (deps.now ?? Date.now)();
  const stamp = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : NaN;
  if (!Number.isFinite(stamp) || Math.abs(now - stamp) > TIMESTAMP_WINDOW_MS) {
    throw new DoorError('The request is too old.', 400);
  }
  const nonce = payload.nonce;
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) {
    throw new DoorError('The request has no valid nonce.', 400);
  }
  if (!deps.nonces.add(nonce, now)) throw new DoorError('This request was already used.', 400);
}

async function targetUser(payload: Record<string, unknown>, deps: DoorDeps): Promise<PageUser | null> {
  const wtId = String(payload.target_wt_id ?? '');
  if (!/^\d+$/.test(wtId)) throw new DoorError('Which person?', 400);
  const email = typeof payload.target_email === 'string' ? payload.target_email.trim().toLowerCase() : '';
  return deps.store.findUser({ wtId, email });
}

/** The only change 24/7 takes is the stream limit, and only when 24/7 keeps its own. Returns the cleaned change. */
async function cleanChanges(payload: Record<string, unknown>, caps: PageCaps, user: PageUser, deps: DoorDeps) {
  const args = isRecord(payload.args) ? payload.args : {};
  const changes = isRecord(args.changes) ? args.changes : {};
  if (!caps.edit) throw new DoorError('You can look at this page but not change it.', 403);
  const errors: Record<string, string> = {};
  const clean: { max_streams?: number } = {};
  for (const key of Object.keys(changes)) {
    if (key !== 'max_streams') errors[key] = 'This cannot be changed here.';
  }
  if ('max_streams' in changes) {
    const value = changes.max_streams;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_STREAMS_LIMIT) {
      errors.max_streams = `Use a whole number from 0 to ${MAX_STREAMS_LIMIT}.`;
    } else {
      const limit = await deps.store.streamLimit(user);
      if (!limit.editable) errors.max_streams = 'While linked to ESPG, the limit follows ESPG TV connections plus one.';
      else if (!limit.has_login) errors.max_streams = 'Make a playlist login for this person first.';
      else clean.max_streams = value;
    }
  }
  if (Object.keys(errors).length) throw new DoorError('Fix the highlighted fields.', 422, errors);
  return clean;
}

async function differs(user: PageUser, clean: { max_streams?: number }, deps: DoorDeps): Promise<boolean> {
  if (clean.max_streams === undefined) return false;
  const limit = await deps.store.streamLimit(user);
  return limit.max_streams !== clean.max_streams;
}

async function run(action: Action, payload: Record<string, unknown>, deps: DoorDeps): Promise<DoorReply> {
  const caps = capsFrom(payload);
  const user = await targetUser(payload, deps);
  if (!user) {
    if (action === 'get') return { status: 200, body: { found: false, message: 'This person has not signed in to 24/7 yet.' } };
    throw new DoorError('This person has not signed in to 24/7 yet.', 404);
  }
  if (action === 'get') {
    const data = await deps.store.read(user);
    return { status: 200, body: { found: true, data: { ...data, rights: { edit: caps.edit } } } };
  }
  const clean = await cleanChanges(payload, caps, user, deps);
  if (action === 'validate') return { status: 200, body: { changed: await differs(user, clean, deps) } };
  if (clean.max_streams !== undefined) await deps.store.setMaxStreams(user, clean.max_streams);
  return { status: 200, body: { saved: true } };
}

export async function handleUserPage(payload: Record<string, unknown>, deps: DoorDeps): Promise<DoorReply> {
  try {
    const action = payload.action;
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
      throw new DoorError('Unknown action.', 400);
    }
    checkFresh(payload, deps);
    return await run(action as Action, payload, deps);
  } catch (error) {
    if (error instanceof DoorError) {
      const body: Record<string, unknown> = { error: error.message };
      if (Object.keys(error.errors).length) body.errors = error.errors;
      return { status: error.status, body };
    }
    console.error('[user_page door] failed', error instanceof Error ? error.name : 'error');
    return { status: 500, body: { error: '24/7 could not complete this.' } };
  }
}
