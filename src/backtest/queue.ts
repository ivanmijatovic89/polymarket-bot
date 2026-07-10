import { Queue, QueueEvents, FlowProducer } from 'bullmq'
import * as IORedisModule from 'ioredis'
import type { Redis, RedisOptions } from 'ioredis'

// ioredis ships its default export under .default for ESM consumers; this
// indirection lets us call `new RedisCtor(...)` reliably under tsx.
const RedisCtor: new (url: string, options?: RedisOptions) => Redis =
  (IORedisModule as unknown as { default: new (url: string, options?: RedisOptions) => Redis })
    .default ?? (IORedisModule as unknown as new (url: string, options?: RedisOptions) => Redis)

export const MARKET_QUEUE = 'backtest-markets'
export const AGGREGATE_QUEUE = 'backtest-aggregate'

let sharedConnection: Redis | null = null

/**
 * Singleton ioredis connection for BullMQ. BullMQ recommends a single connection
 * shared between Queue/Worker/QueueEvents/FlowProducer instances within a process.
 *
 * Reads REDIS_URL (default redis://localhost:6379). Supports redis:// and rediss://.
 */
export function getRedisConnection(): Redis {
  if (sharedConnection) return sharedConnection
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const options: RedisOptions = {
    // BullMQ requires this to be null for Worker connections (no auto-reconnect of commands).
    maxRetriesPerRequest: null,
    // Enable connection-level reconnect but don't deadlock blocking commands.
    enableReadyCheck: false,
  }
  const conn = new RedisCtor(url, options)
  sharedConnection = conn
  return conn
}

/**
 * Close the shared connection (only call at process shutdown).
 */
export async function closeRedisConnection(): Promise<void> {
  if (!sharedConnection) return
  try {
    await sharedConnection.quit()
  } catch {
    sharedConnection.disconnect()
  }
  sharedConnection = null
}

let marketQueueSingleton: Queue | null = null
let aggregateQueueSingleton: Queue | null = null
let flowProducerSingleton: FlowProducer | null = null

export function getMarketQueue(): Queue {
  if (!marketQueueSingleton) {
    marketQueueSingleton = new Queue(MARKET_QUEUE, { connection: getRedisConnection() })
  }
  return marketQueueSingleton
}

export function getAggregateQueue(): Queue {
  if (!aggregateQueueSingleton) {
    aggregateQueueSingleton = new Queue(AGGREGATE_QUEUE, { connection: getRedisConnection() })
  }
  return aggregateQueueSingleton
}

export function getFlowProducer(): FlowProducer {
  if (!flowProducerSingleton) {
    flowProducerSingleton = new FlowProducer({ connection: getRedisConnection() })
  }
  return flowProducerSingleton
}

export function getQueueEvents(queueName: string): QueueEvents {
  return new QueueEvents(queueName, { connection: getRedisConnection() })
}

/**
 * Job options used for every market job we enqueue.
 *  - 3 attempts with exponential backoff (handles transient parquet/R2/Redis hiccups).
 *  - removeOnComplete: false — results stay in Redis until the FlowProducer parent
 *    (aggregator) consumes them via getChildrenValues(). The aggregator then
 *    explicitly removes children to bound Redis memory.
 *  - removeOnFail: false — keep failures for audit + dashboard display.
 */
export const MARKET_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: false,
  removeOnFail: false,
}

export const AGGREGATE_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  // The aggregator persists run metadata / per-segment stats / normalized
  // market rows / failure rows into MySQL before returning. Once that's done
  // there is nothing left in the parent job worth caching. Successful parent
  // jobs are keyed by submissionUid, but removing them still bounds Redis
  // memory and keeps Bull Board focused on active/failed work.
  // Remove on success; keep failures so they're visible in Bull Board.
  removeOnComplete: true,
  removeOnFail: false,
}

/**
 * Worker options applied to both market and aggregate workers.
 *  - lockDuration: 3 min upper bound per job. Also the worst-case time a job
 *    orphaned by a HARD-killed worker (crash/reboot) stays "active" before the
 *    stalled-checker reclaims it, so we keep it as low as is safely above the
 *    longest single job (market replays are seconds).
 *  - stalledInterval: 30s — frequency of stalled-job detection.
 *  - maxStalledCount: 1 — a job that goes stalled twice is moved to failed
 *    so it doesn't loop forever.
 */
export const WORKER_OPTS = {
  lockDuration: 3 * 60 * 1000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
}
