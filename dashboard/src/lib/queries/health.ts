import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import { getRedis } from '../redis'
import { AGGREGATE_QUEUE, MARKET_QUEUE, getAggregateQueue, getMarketQueue } from '../queue'
import { listWorkers } from './workers'

export type HealthCheck = {
  name: string
  status: 'ok' | 'degraded' | 'down'
  latencyMs: number | null
  detail: string
}

export type HealthReport = {
  ok: boolean
  checkedAtMs: number
  queues: { market: string; aggregate: string }
  checks: HealthCheck[]
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t0 }
}

async function checkRedis(): Promise<HealthCheck> {
  try {
    const { ms } = await timed(() => getRedis().ping())
    return {
      name: 'Redis',
      status: ms < 50 ? 'ok' : 'degraded',
      latencyMs: ms,
      detail: `PING → PONG in ${ms} ms`,
    }
  } catch (e) {
    return {
      name: 'Redis',
      status: 'down',
      latencyMs: null,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

async function checkMysql(): Promise<HealthCheck> {
  try {
    const { ms } = await timed(() => getDb().execute(sql`SELECT 1`))
    return {
      name: 'MySQL',
      status: ms < 100 ? 'ok' : 'degraded',
      latencyMs: ms,
      detail: `SELECT 1 in ${ms} ms`,
    }
  } catch (e) {
    return {
      name: 'MySQL',
      status: 'down',
      latencyMs: null,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

async function checkQueues(): Promise<HealthCheck> {
  try {
    const { value, ms } = await timed(async () => {
      const [m, a] = await Promise.all([
        getMarketQueue().getJobCounts('waiting', 'active', 'failed'),
        getAggregateQueue().getJobCounts('waiting', 'active', 'failed'),
      ])
      return { m, a }
    })
    const mFailed = Number(value.m.failed ?? 0)
    const aFailed = Number(value.a.failed ?? 0)
    const status: HealthCheck['status'] = mFailed > 0 || aFailed > 0 ? 'degraded' : 'ok'
    return {
      name: 'BullMQ queues',
      status,
      latencyMs: ms,
      detail:
        status === 'degraded'
          ? `${mFailed + aFailed} job(s) failed (market ${mFailed}, aggregate ${aFailed})`
          : 'No failed jobs',
    }
  } catch (e) {
    return {
      name: 'BullMQ queues',
      status: 'down',
      latencyMs: null,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

async function checkWorkers(): Promise<HealthCheck> {
  try {
    const { value: workers, ms } = await timed(() => listWorkers())
    const alive = workers.filter((w) => w.alive).length
    const total = workers.length
    if (total === 0) {
      return {
        name: 'Workers',
        status: 'degraded',
        latencyMs: ms,
        detail: 'No workers registered',
      }
    }
    return {
      name: 'Workers',
      status: alive > 0 ? 'ok' : 'degraded',
      latencyMs: ms,
      detail: `${alive}/${total} alive`,
    }
  } catch (e) {
    return {
      name: 'Workers',
      status: 'down',
      latencyMs: null,
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function runHealthChecks(): Promise<HealthReport> {
  const checks = await Promise.all([checkRedis(), checkMysql(), checkQueues(), checkWorkers()])
  return {
    ok: checks.every((c) => c.status !== 'down'),
    checkedAtMs: Date.now(),
    queues: { market: MARKET_QUEUE, aggregate: AGGREGATE_QUEUE },
    checks,
  }
}
