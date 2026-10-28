import { postSignedEvent, type PostResult, type WatchTowerLink } from './wt-signed-post';

/**
 * Tells WatchTower "this person just signed in to 24/7" (event `app.login`), so the Users tab can show
 * the last sign-in for each app. Best effort: it never fails or slows a sign-in for long.
 */

export type AppLoginEvent = {
  event_type: 'app.login';
  occurred_at: string;
  watchtower_user_id: number | null;
  user_email?: string;
};

export function buildAppLoginEvent(
  who: { watchTowerUserId?: string | null; email?: string | null },
  now: Date,
): AppLoginEvent | null {
  const id = /^\d+$/.test(String(who.watchTowerUserId ?? '')) ? Number(who.watchTowerUserId) : null;
  const email = (who.email || '').trim().toLowerCase();
  if (id === null && !email) return null;
  return {
    event_type: 'app.login',
    occurred_at: now.toISOString(),
    watchtower_user_id: id,
    ...(email ? { user_email: email } : {}),
  };
}

export async function reportAppLogin(
  who: { watchTowerUserId?: string | null; email?: string | null },
  deps: {
    link(): Promise<WatchTowerLink | null>;
    post?(link: WatchTowerLink, event: AppLoginEvent): Promise<PostResult>;
    now?(): Date;
  },
): Promise<boolean> {
  try {
    const event = buildAppLoginEvent(who, (deps.now ?? (() => new Date()))());
    if (!event) return false;
    const link = await deps.link();
    if (!link) return false;
    const post = deps.post ?? ((l, e) => postSignedEvent(l, e, { timeoutMs: 4000 }));
    return (await post(link, event)).ok;
  } catch {
    return false;
  }
}
