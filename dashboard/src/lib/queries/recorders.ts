import IORedis from 'ioredis'
import { z } from 'zod'
import {
  RECORDER_OFFLINE_AFTER_MS,
  RECORDER_STATUS_PREFIX,
  RECORDER_STATUS_SET,
  type RecorderStatus,
} from '../../../../src/recorder-v3/statusTypes'

const count = z.number().finite().nonnegative()
const text = z.string().max(10_000)
const schema = z.object({
  schemaVersion: z.literal(3),
  recorderId: text,
  captureId: text,
  sessionId: text,
  host: text,
  pid: count,
  startedAtMs: count,
  updatedAtMs: count,
  state: z.enum(['starting', 'recording', 'degraded', 'stopping', 'stopped', 'error']),
  reason: text.nullable(),
  feeds: z
    .array(
      z.object({
        feed: z.enum([
          'polymarket',
          'binance_agg_trade',
          'binance_book_ticker',
          'chainlink_spot',
          'chainlink_twap',
          'price_to_beat',
        ]),
        state: text,
        lastReceivedAtMs: count.nullable(),
        messages: count,
        reconnects: count,
      }),
    )
    .max(20),
  markets: z
    .array(
      z.object({
        slug: text,
        timeframe: text,
        active: z.boolean(),
        rows: count,
        gaps: count,
        booksReady: z.boolean(),
      }),
    )
    .max(100),
  spool: z.object({
    bytes: count,
    maxBytes: count,
    freeBytes: count,
    minFreeBytes: count,
    pendingWrites: count,
  }),
  archive: z.object({
    enabled: z.boolean(),
    pendingMarkets: count,
    uploadedMarkets: count,
    lastSuccessAtMs: count.nullable(),
    lastError: text.nullable(),
  }),
  resolution: z.object({ pending: count, lastError: text.nullable() }),
  metrics: z.object({ rssBytes: count, eventLoopLagMs: count, cpuPercent: count }),
  recentMarkets: z
    .array(
      z.object({
        slug: text,
        timeframe: z.enum(['5m', '15m']),
        startMs: count,
        endMs: count,
        rows: count,
        gaps: count,
        complete: z.boolean(),
        manifestKey: text.nullable(),
        resolution: text,
      }),
    )
    .max(200),
})

export type RecorderEntry = {
  recorderId: string
  status: RecorderStatus | null
  online: boolean
  error: string | null
}
export type RecordersReport = {
  checkedAtMs: number
  error: string | null
  recorders: RecorderEntry[]
}

export function recorderIsOnline(status: RecorderStatus, now: number): boolean {
  const age = now - status.updatedAtMs
  return (
    age >= -5_000 &&
    age <= RECORDER_OFFLINE_AFTER_MS &&
    status.state !== 'stopped' &&
    status.state !== 'error'
  )
}

export function parseRecorderStatus(id: string, raw: string | null, now: number): RecorderEntry {
  if (!raw)
    return {
      recorderId: id,
      status: null,
      online: false,
      error: 'Registered recorder has no status report',
    }
  try {
    if (raw.length > 2_000_000) throw new Error('Oversized report')
    const status: RecorderStatus = schema.parse(JSON.parse(raw))
    if (status.recorderId !== id) throw new Error('Mismatched recorder identity')
    return { recorderId: id, status, online: recorderIsOnline(status, now), error: null }
  } catch {
    return { recorderId: id, status: null, online: false, error: 'Invalid recorder status report' }
  }
}

type StatusReader = {
  smembers(key: string): Promise<string[]>
  mget(...keys: string[]): Promise<Array<string | null>>
}

export async function readRecorderReports(
  reader: StatusReader,
  now = Date.now(),
  timeoutMs = 2_000,
): Promise<RecordersReport> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const read = async (): Promise<RecordersReport> => {
    const ids = (await reader.smembers(RECORDER_STATUS_SET)).sort()
    if (ids.length > 100) throw new Error('Recorder registration count exceeds dashboard limit')
    const values = ids.length
      ? await reader.mget(...ids.map((id) => `${RECORDER_STATUS_PREFIX}${id}`))
      : []
    return {
      checkedAtMs: now,
      error: null,
      recorders: ids.map((id, index) => parseRecorderStatus(id, values[index] ?? null, now)),
    }
  }
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Recorder status query timed out')), timeoutMs)
      }),
    ])
  } catch {
    return {
      checkedAtMs: now,
      error: 'Recorder monitoring is unavailable. Status cannot be confirmed.',
      recorders: [],
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function getRecordersReport(): Promise<RecordersReport> {
  // A short-lived connection bounds both queued commands and socket lifetime
  // if monitoring Redis is unavailable. It never touches recorder capture.
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  })
  redis.on('error', () => undefined)
  try {
    await redis.connect()
    return await readRecorderReports(redis)
  } catch {
    return {
      checkedAtMs: Date.now(),
      error: 'Recorder monitoring is unavailable. Status cannot be confirmed.',
      recorders: [],
    }
  } finally {
    redis.disconnect()
  }
}
