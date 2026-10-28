import crypto from 'crypto';
import { postSignedCall, type CallResult, type WatchTowerLink } from './wt-signed-post';

/**
 * The Users tab in 24/7 is WatchTower's Users tab. 24/7 holds no copy of the rules: it signs a call
 * naming the signed-in person by WatchTower id, and WatchTower works out from that person's role what
 * they may see and change, applies the change, and records it in the audit log with them as the actor.
 */

/** The only actions the tab may send. Anything else is refused here before WatchTower is asked. */
export const USERS_TAB_ACTIONS = ['set_role', 'approve', 'deny', 'edit_basic', 'set_app_access'] as const;
export type UsersTabAction = (typeof USERS_TAB_ACTIONS)[number];

export type UsersTabDeps = {
  link(): Promise<WatchTowerLink | null>;
  post?: (link: WatchTowerLink, payload: unknown) => Promise<CallResult>;
  now?(): Date;
  nonce?(): string;
};

export type UsersTabCaller = { watchTowerUserId?: string | null };

export function isUsersTabAction(value: unknown): value is UsersTabAction {
  return typeof value === 'string' && (USERS_TAB_ACTIONS as readonly string[]).includes(value);
}

export async function callUsersTab(
  caller: UsersTabCaller,
  action: 'list' | UsersTabAction,
  args: Record<string, unknown>,
  deps: UsersTabDeps,
): Promise<CallResult> {
  const wtId = String(caller.watchTowerUserId ?? '');
  if (!/^\d+$/.test(wtId)) {
    return { status: 403, body: { error: 'Only WatchTower accounts can use the Users tab.' } };
  }
  let link: WatchTowerLink | null;
  try {
    link = await deps.link();
  } catch {
    link = null;
  }
  if (!link) return { status: 503, body: { error: 'WatchTower is not connected.' } };
  const payload = {
    event_type: 'users_tab',
    timestamp: (deps.now ?? (() => new Date()))().toISOString(),
    nonce: (deps.nonce ?? (() => crypto.randomBytes(16).toString('hex')))(),
    actor_id: Number(wtId),
    action,
    args,
  };
  const post = deps.post ?? ((l, p) => postSignedCall(l, p));
  return post(link, payload);
}
