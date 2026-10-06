import { Redis } from 'ioredis'
import path from 'node:path'
import { atomicWrite } from './storage/files.js'
import { RECORDER_STATUS_PREFIX, RECORDER_STATUS_SET, type RecorderStatus } from './statusTypes.js'

/** Optional dashboard transport: no offline queue and never part of the ingestion path. */
export function createStatusPublisher(spoolDir: string, redisUrl: string | null) {
  const redis = redisUrl
    ? new Redis(redisUrl, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        commandTimeout: 2000,
        retryStrategy: (attempt: number) => Math.min(attempt * 1000, 30_000),
      })
    : null
  redis?.on('error', () => {
    /* A failed dashboard connection must not stop recording. */
  })
  return {
    async publish(status: RecorderStatus): Promise<void> {
      const raw = JSON.stringify(status)
      await atomicWrite(path.join(spoolDir, 'status.json'), raw)
      if (!redis || redis.status !== 'ready') return
      // Retain identity and last status so an offline recorder remains visible.
      await redis.set(`${RECORDER_STATUS_PREFIX}${status.recorderId}`, raw)
      await redis.sadd(RECORDER_STATUS_SET, status.recorderId)
    },
    close(): void {
      redis?.disconnect()
    },
  }
}
