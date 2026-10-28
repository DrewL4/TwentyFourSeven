import crypto from 'crypto';

/**
 * Signed events from TwentyFourSeven to WatchTower.
 *
 * Same convention WatchTower uses when it calls us: HMAC-SHA256 of the exact body
 * with the shared webhook secret, sent as `X-Webhook-Signature: sha256=<hex>`.
 * The secret is never logged or put in an error message.
 */

export const WT_EVENT_PATH = '/api/webhooks/twentyfourseven/';

export function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

export type WatchTowerLink = { url: string; secret: string };

/** `ok` is true only when WatchTower accepted the event (2xx). `error` is a short reason, never a secret. */
export type PostResult = { ok: boolean; error?: string };

export async function postSignedEvent(
  link: WatchTowerLink,
  payload: unknown,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<PostResult> {
  const body = JSON.stringify(payload);
  const doFetch = deps.fetch ?? fetch;
  try {
    const response = await doFetch(`${link.url.replace(/\/+$/, '')}${WT_EVENT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signBody(link.secret, body) },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.name : 'error' };
  }
}

export type CallResult = { status: number; body: any };

/**
 * Like postSignedEvent, but for a call whose answer we need (the Users tab): returns WatchTower's
 * HTTP status and JSON body. A network failure is 502, so callers can show a plain message.
 */
export async function postSignedCall(
  link: WatchTowerLink,
  payload: unknown,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<CallResult> {
  const body = JSON.stringify(payload);
  const doFetch = deps.fetch ?? fetch;
  try {
    const response = await doFetch(`${link.url.replace(/\/+$/, '')}${WT_EVENT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signBody(link.secret, body) },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15000),
    });
    let parsed: any;
    try {
      parsed = await response.json();
    } catch {
      parsed = { error: `WatchTower answered with HTTP ${response.status}.` };
    }
    return { status: response.status, body: parsed };
  } catch {
    return { status: 502, body: { error: 'Could not reach WatchTower.' } };
  }
}
