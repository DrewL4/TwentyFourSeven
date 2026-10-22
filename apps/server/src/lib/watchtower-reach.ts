// How TwentyFourSeven talks about reaching WatchTower. Kept free of Next/Prisma
// imports so node:test can cover it.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** True when the address points back at this container (localhost, 127.x, ::1). */
export function isLoopbackUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host) || host.startsWith('127.') || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

const RECONNECT_HINT =
  'In WatchTower, open Admin → Connections → WatchTower Guide & TFS Connect ' +
  'and click Connect on the TwentyFourSeven card again.';

function loopbackNote(url: string): string {
  return isLoopbackUrl(url)
    ? ` "${new URL(url).host}" inside TwentyFourSeven's container means TwentyFourSeven itself, not WatchTower: ` +
        'WatchTower needs to give TwentyFourSeven an address it can reach, such as your server\'s IP or domain.'
    : '';
}

/** Message for "the request never got a WatchTower answer" (network error, wrong app, redirect). */
export function watchTowerUnreachableMessage(url: string, reason?: string): string {
  const why = reason ? ` (${reason})` : '';
  return `TwentyFourSeven can't reach WatchTower at ${url}${why}.${loopbackNote(url)} ${RECONNECT_HINT}`;
}

/** Short reason for a failed fetch(), e.g. "connection refused". */
export function describeFetchError(error: unknown): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string } };
  const code = err?.cause?.code;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'no answer in time';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'address not found';
  if (code === 'ECONNRESET') return 'connection reset';
  if (code) return code;
  return err?.message || 'network error';
}

export type WatchTowerLoginOutcome =
  | { kind: 'ok' }
  | { kind: 'bad_credentials'; message: string }
  | { kind: 'not_watchtower'; message: string };

/**
 * Sort a non-2xx answer from WatchTower's /api/api/v1/auth/login/.
 * Only a JSON 400/401 is WatchTower itself saying no; anything else (a web page,
 * a redirect, 404, 5xx) means the address is not WatchTower's API.
 */
export function classifyWatchTowerLoginFailure(
  url: string,
  status: number,
  contentType: string | null,
  body: string,
): WatchTowerLoginOutcome {
  const isJson = (contentType || '').includes('application/json');
  if (isJson && (status === 400 || status === 401)) {
    let wtError = '';
    try {
      wtError = String(JSON.parse(body)?.error || '');
    } catch {
      wtError = '';
    }
    if (/disabled/i.test(wtError)) {
      return { kind: 'bad_credentials', message: 'Your WatchTower account is disabled. Ask your WatchTower admin.' };
    }
    return {
      kind: 'bad_credentials',
      message: 'Invalid WatchTower credentials. Check your WatchTower email or username and password.',
    };
  }
  return {
    kind: 'not_watchtower',
    message: watchTowerUnreachableMessage(url, `it answered HTTP ${status}, not like WatchTower`),
  };
}

export type ReachResult = { ok: true } | { ok: false; error: string };

/**
 * Round trip to WatchTower with the integration token
 * (POST /api/api/v1/auth/validate-api-token/). Cheap, read-only.
 */
export async function checkWatchTowerReachable(
  url: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReachResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${url}/api/api/v1/auth/validate-api-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: apiToken }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    return { ok: false, error: watchTowerUnreachableMessage(url, describeFetchError(error)) };
  }
  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  if (!isJson) {
    return {
      ok: false,
      error: watchTowerUnreachableMessage(url, `it answered HTTP ${response.status}, not like WatchTower`),
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error:
        `WatchTower at ${url} did not accept TwentyFourSeven's app token. ` +
        'In WatchTower, click Create App Tokens, then Connect on the TwentyFourSeven card again.',
    };
  }
  if (!response.ok) {
    return { ok: false, error: `WatchTower at ${url} answered HTTP ${response.status}. Try again in a minute.` };
  }
  return { ok: true };
}
