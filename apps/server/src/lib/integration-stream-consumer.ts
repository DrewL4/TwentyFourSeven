/**
 * Optional Redis Stream consumer for WatchTower integration events.
 * Enable via WatchTower Admin → Integration → Redis event bus per app.
 */

import { WatchTowerHubService } from './watchtower-hub-service';
import { db } from './context';

const STREAM_KEY = 'wt:integration';
const GROUP = 'twentyfourseven_integration';
const CONSUMER = 'tfs_worker_1';

/** ioredis xreadgroup shape: [streamName, [id, fieldPairs][]][] */
type RedisStreamReadResult = Array<
  [string, Array<[string, string[]]>]
> | null;

export async function consumeIntegrationStream(batchSize = 10): Promise<number> {
  const enabled = await db.setting.findUnique({
    where: { key: 'watchtower_redis_stream_enabled' },
  });
  if (enabled?.value !== 'true') {
    return 0;
  }

  const redisUrl = process.env.REDIS_URL || process.env.CELERY_BROKER_URL;
  if (!redisUrl) {
    return 0;
  }

  try {
    const Redis = (await import('ioredis')).default;
    const client = new Redis(redisUrl);
    try {
      await client.xgroup('CREATE', STREAM_KEY, GROUP, '0', 'MKSTREAM');
    } catch {
      // group exists
    }

    const result = (await client.xreadgroup(
      'GROUP',
      GROUP,
      CONSUMER,
      'COUNT',
      batchSize,
      'BLOCK',
      1000,
      'STREAMS',
      STREAM_KEY,
      '>',
    )) as RedisStreamReadResult;

    if (!result) {
      await client.quit();
      return 0;
    }

    const hub = WatchTowerHubService.getInstance();
    let processed = 0;

    for (const [, messages] of result) {
      for (const [id, fields] of messages) {
        const eventType = fields[1];
        const payloadRaw = fields[3];
        try {
          const payload = JSON.parse(payloadRaw);
          await hub.handleWebhookEvent({
            event_type: eventType,
            timestamp: new Date().toISOString(),
            data: payload.data || payload,
          });
          await client.xack(STREAM_KEY, GROUP, id);
          processed += 1;
        } catch (error) {
          console.error('Stream message failed:', id, error);
        }
      }
    }

    await client.quit();
    return processed;
  } catch (error) {
    console.debug('Integration stream consumer skipped:', error);
    return 0;
  }
}
