import IORedis, { type Redis, type RedisOptions } from 'ioredis'

declare global {
  // eslint-disable-next-line no-var
  var __dashboardRedis: Redis | undefined
}

export function getRedis(): Redis {
  if (globalThis.__dashboardRedis) return globalThis.__dashboardRedis
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
  const conn = new IORedis(url, options)
  globalThis.__dashboardRedis = conn
  return conn
}
