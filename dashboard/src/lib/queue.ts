import { Queue, type ConnectionOptions } from 'bullmq'

export const MARKET_QUEUE = 'backtest-markets'
export const AGGREGATE_QUEUE = 'backtest-aggregate'

declare global {
  // eslint-disable-next-line no-var
  var __dashboardMarketQueue: Queue | undefined
  // eslint-disable-next-line no-var
  var __dashboardAggregateQueue: Queue | undefined
}

/**
 * Parse REDIS_URL into BullMQ ConnectionOptions. We don't share an ioredis
 * instance with `lib/redis.ts` because bullmq ships its own nested copy of
 * ioredis and the types don't unify.
 */
function bullConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const u = new URL(url)
  const opts: ConnectionOptions = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
  if (u.password) opts.password = decodeURIComponent(u.password)
  if (u.username) opts.username = decodeURIComponent(u.username)
  if (u.protocol === 'rediss:') opts.tls = {}
  return opts
}

export function getMarketQueue(): Queue {
  if (globalThis.__dashboardMarketQueue) return globalThis.__dashboardMarketQueue
  const q = new Queue(MARKET_QUEUE, { connection: bullConnection() })
  globalThis.__dashboardMarketQueue = q
  return q
}

export function getAggregateQueue(): Queue {
  if (globalThis.__dashboardAggregateQueue) return globalThis.__dashboardAggregateQueue
  const q = new Queue(AGGREGATE_QUEUE, { connection: bullConnection() })
  globalThis.__dashboardAggregateQueue = q
  return q
}

export function aggregateJobId(batchUid: string): string {
  return `${batchUid}-agg`
}
