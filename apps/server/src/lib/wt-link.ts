import { db } from './context';
import type { WatchTowerLink } from './wt-signed-post';

/** WatchTower's address and the shared webhook secret, from Settings. null until both are set. */
export async function watchTowerLink(): Promise<WatchTowerLink | null> {
  const rows = await db.setting.findMany({
    where: { key: { in: ['watchtower_url', 'watchtower_webhook_secret'] } },
    select: { key: true, value: true },
  });
  const map = new Map<string, string>(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
  const url = (map.get('watchtower_url') || '').trim();
  const secret = map.get('watchtower_webhook_secret') || '';
  return url && secret ? { url, secret } : null;
}
