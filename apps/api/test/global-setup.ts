import Redis from 'ioredis';

/**
 * Clears rate-limit counters before an e2e run.
 *
 * The suites sign in dozens of times from one IP. Once the limiter trips it
 * blocks that IP for five minutes, so a run that exceeded the limit poisons the
 * NEXT run too — producing 429s that look like isolation failures and say
 * nothing about what is actually being tested.
 *
 * Only `rl:*` keys are touched. Flushing the database would take the cache and
 * BullMQ with it.
 */
export default async function globalSetup(): Promise<void> {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    // Redis unavailable: the suite will fail for a clearer reason shortly.
  } finally {
    redis.disconnect();
  }
}
