import { postSignedEvent, type PostResult, type WatchTowerLink } from './wt-signed-post';

/**
 * Tells WatchTower "this person just watched 24/7" (event `viewing.activity`), so its
 * Users page can show when each person last used 24/7.
 *
 * WatchTower works out who it was from `playlist_username` first, then `user_email`,
 * then `client_ip` (only when exactly one person has used that address lately).
 *
 * Never slows or breaks a stream: the call is fire-and-forget, sent at most once per
 * person per THROTTLE_MS, and after a failed send nothing more is sent for
 * FAILURE_BACKOFF_MS (WatchTower being down must not cost a request per stream start).
 */

export const THROTTLE_MS = 5 * 60 * 1000;
export const FAILURE_BACKOFF_MS = 60 * 1000;
const MAX_REMEMBERED = 2000;

export type ViewingActivity = {
  /** The playlist login the TV app used, when it used one. */
  playlistUsername?: string | null;
  /** The signed-in person's e-mail, when known. */
  email?: string | null;
  clientIp?: string | null;
  /** What they are watching, e.g. "Channel 5 Movies - Alien". Shown as "last used" in the Users tab. */
  what?: string | null;
};

export type ViewingActivityEvent = {
  event_type: 'viewing.activity';
  timestamp: string;
  occurred_at: string;
  playlist_username?: string;
  user_email?: string;
  client_ip?: string;
  what?: string;
};

export function buildViewingActivityEvent(a: ViewingActivity, now: Date): ViewingActivityEvent | null {
  const playlist = (a.playlistUsername || '').trim();
  const email = (a.email || '').trim().toLowerCase();
  const ip = (a.clientIp || '').trim();
  const what = (a.what || '').trim().slice(0, 200);
  if (!playlist && !email && !ip) return null;
  const iso = now.toISOString();
  return {
    event_type: 'viewing.activity',
    timestamp: iso,
    occurred_at: iso,
    ...(playlist ? { playlist_username: playlist } : {}),
    ...(email ? { user_email: email } : {}),
    ...(ip ? { client_ip: ip } : {}),
    ...(what ? { what } : {}),
  };
}

/** One throttle key per person: the strongest identity we have. */
export function throttleKey(a: ViewingActivity): string {
  const playlist = (a.playlistUsername || '').trim().toLowerCase();
  if (playlist) return `login:${playlist}`;
  const email = (a.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  return `ip:${(a.clientIp || '').trim()}`;
}

export type EmitterDeps = {
  link(): Promise<WatchTowerLink | null>;
  post?(link: WatchTowerLink, event: ViewingActivityEvent): Promise<PostResult>;
  now?(): number;
};

export function createViewingActivityEmitter(deps: EmitterDeps) {
  const lastSent = new Map<string, number>();
  let pausedUntil = 0;
  const now = deps.now ?? Date.now;
  const post = deps.post ?? ((link, event) => postSignedEvent(link, event));

  /** Returns true when an event was handed to WatchTower (for tests); callers do not wait on it. */
  async function send(a: ViewingActivity): Promise<boolean> {
    const at = now();
    const event = buildViewingActivityEvent(a, new Date(at));
    if (!event || at < pausedUntil) return false;
    const key = throttleKey(a);
    const previous = lastSent.get(key);
    if (previous !== undefined && at - previous < THROTTLE_MS) return false;
    // Claim the slot before awaiting so two streams starting together send one event.
    lastSent.set(key, at);
    if (lastSent.size > MAX_REMEMBERED) {
      for (const [k, t] of lastSent) if (at - t >= THROTTLE_MS) lastSent.delete(k);
      if (lastSent.size > MAX_REMEMBERED) lastSent.clear();
    }
    try {
      const link = await deps.link();
      if (!link) {
        lastSent.delete(key);
        return false;
      }
      const result = await post(link, event);
      if (!result.ok) {
        lastSent.delete(key);
        pausedUntil = now() + FAILURE_BACKOFF_MS;
        console.warn(`[viewing.activity] WatchTower did not accept it (${result.error ?? 'error'}); pausing ${FAILURE_BACKOFF_MS / 1000}s`);
        return false;
      }
      return true;
    } catch (error) {
      lastSent.delete(key);
      pausedUntil = now() + FAILURE_BACKOFF_MS;
      console.warn('[viewing.activity] send failed:', error instanceof Error ? error.name : 'error');
      return false;
    }
  }

  /** Fire and forget: never throws, never waits. */
  function emit(a: ViewingActivity): void {
    void send(a);
  }

  return { emit, send };
}
