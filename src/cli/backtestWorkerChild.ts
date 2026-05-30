import '../config/env.js'
import { execSync } from 'node:child_process'
import { Worker } from 'bullmq'
import { requireEnv } from '../config/env.js'
import {
  MARKET_QUEUE,
  WORKER_OPTS,
  closeRedisConnection,
  getRedisConnection,
} from '../backtest/queue.js'
import { makeMarketProcessor } from '../backtest/marketProcessor.js'
import { defaultWorkerName } from '../backtest/workerIdentity.js'

/**
 * Single-concurrency market worker meant to be forked N times by
 * `backtestWorker.ts` so we get **real CPU parallelism**.
 *
 * Each child is its own Node process — own event loop, own V8 isolate —
 * so 8 children spawned by the supervisor saturate 8 cores.
 *
 * Inherited env (REDIS_URL, DATABASE_*, R2_*, etc.) comes from the
 * supervisor's process.env via child_process.fork.
 */

function getCurrentGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

async function recordWorkerStats(
  workerName: string,
  result: { eventsProcessed: number } | null | undefined,
  slug: string | null,
): Promise<void> {
  const conn = getRedisConnection()
  const events = result?.eventsProcessed ?? 0
  try {
    const pipe = conn.pipeline()
    pipe.hincrby(`backtest:worker:${workerName}`, 'processedTotal', 1)
    if (events > 0) pipe.hincrby(`backtest:worker:${workerName}`, 'eventsTotal', events)
    if (slug) pipe.hset(`backtest:worker:${workerName}`, 'lastMarket', slug)
    pipe.hset(`backtest:worker:${workerName}`, 'lastFinishedAt', String(Date.now()))
    await pipe.exec()
  } catch {
    /* best-effort */
  }
}

async function startHeartbeat(workerName: string): Promise<() => Promise<void>> {
  const conn = getRedisConnection()
  const write = async (): Promise<void> => {
    try {
      await conn.set(`backtest:worker:${workerName}:heartbeat`, String(Date.now()), 'EX', 60)
      await conn.hset(`backtest:worker:${workerName}`, 'commitSha', getCurrentGitSha())
    } catch {
      /* best-effort */
    }
  }
  await write()
  const timer = setInterval(write, 5000)
  return async () => {
    clearInterval(timer)
    try {
      await conn.del(`backtest:worker:${workerName}:heartbeat`)
    } catch {
      /* best-effort */
    }
  }
}

async function main(): Promise<void> {
  // Convention: the supervisor passes `--worker-name foo --child-id N`.
  const argv = process.argv.slice(2)
  let workerName = process.env.WORKER_NAME ?? defaultWorkerName()
  let childId = '0'
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--worker-name') workerName = argv[++i]!
    else if (argv[i] === '--child-id') childId = argv[++i]!
  }
  // Each child registers under its own per-pid name so the dashboard can
  // show real per-process activity. The supervisor maintains the
  // aggregate row separately under the bare worker-name.
  const fullName = `${workerName}#${childId}`

  requireEnv(['REDIS_URL'])
  try {
    await getRedisConnection().ping()
  } catch (err) {
    console.error(`[worker-child=${fullName}] redis ping failed:`, err)
    process.exit(2)
  }

  console.log(`[worker-child=${fullName}] ready commitSha=${getCurrentGitSha()}`)

  const stopHeartbeat = await startHeartbeat(fullName)
  const processor = makeMarketProcessor(fullName)
  const w = new Worker(
    MARKET_QUEUE,
    async (job) => {
      const result = await processor(job)
      await recordWorkerStats(fullName, result, result.slug)
      return result
    },
    {
      connection: getRedisConnection(),
      concurrency: 1, // CRITICAL: real parallelism comes from N children, not concurrency.
      ...WORKER_OPTS,
    },
  )
  w.on('failed', (job, err) => {
    console.warn(
      `[worker-child=${fullName}] failed jobId=${job?.id ?? '?'} attempt=${job?.attemptsMade ?? '?'} err=${err.message}`,
    )
  })
  w.on('error', (err) => {
    console.error(`[worker-child=${fullName}] error:`, err.message)
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[worker-child=${fullName}] ${signal} draining...`)
    // Hard backstop: if BullMQ's blocking poll doesn't release in 5s,
    // exit anyway so the supervisor doesn't SIGKILL us at the 30s mark.
    const hardExit = setTimeout(() => process.exit(0), 5_000)
    hardExit.unref()
    try {
      await stopHeartbeat()
    } catch {
      /* ignore */
    }
    try {
      await w.close()
    } catch {
      /* ignore */
    }
    try {
      await closeRedisConnection()
    } catch {
      /* ignore */
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // If the supervisor dies, our IPC channel disconnects — bail too so we
  // don't become an orphaned worker holding a Redis connection forever.
  process.on('disconnect', () => void shutdown('DISCONNECT'))
}

main().catch((err) => {
  console.error('[worker-child] startup failed:', err)
  process.exit(1)
})
