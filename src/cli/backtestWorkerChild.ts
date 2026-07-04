import '../config/env.js'
import { DelayedError, Worker } from 'bullmq'
import {
  MARKET_QUEUE,
  WORKER_OPTS,
  closeRedisConnection,
  getRedisConnection,
} from '../backtest/queue.js'
import { SELF_UPDATE_EXIT_CODE } from '../backtest/commitGate.js'
import { makeMarketProcessor } from '../backtest/marketProcessor.js'
import {
  getCurrentGitBranch,
  getCurrentGitSha,
  getMachineId,
  getRedisProcessKey,
  startHeartbeat,
} from '../backtest/workerIdentity.js'

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

async function recordWorkerStats(
  processKey: string,
  result: { eventsProcessed: number } | null | undefined,
  slug: string | null,
): Promise<void> {
  const conn = getRedisConnection()
  const events = result?.eventsProcessed ?? 0
  try {
    const pipe = conn.pipeline()
    pipe.hincrby(`backtest:worker:${processKey}`, 'processedTotal', 1)
    if (events > 0) pipe.hincrby(`backtest:worker:${processKey}`, 'eventsTotal', events)
    if (slug) pipe.hset(`backtest:worker:${processKey}`, 'lastMarket', slug)
    pipe.hset(`backtest:worker:${processKey}`, 'lastFinishedAt', String(Date.now()))
    await pipe.exec()
  } catch {
    /* best-effort */
  }
}

function isDelayedJobSignal(err: unknown): boolean {
  return err instanceof DelayedError || (err instanceof Error && err.name === 'DelayedError')
}

function requestSupervisorSelfUpdate(processKey: string): void {
  console.warn(
    `[worker-child=${processKey}] stale-code job deferred; exiting ${SELF_UPDATE_EXIT_CODE} for supervisor update`,
  )
  setTimeout(() => process.exit(SELF_UPDATE_EXIT_CODE), 250).unref()
}

async function main(): Promise<void> {
  // Convention: the supervisor passes `--child-id N`.
  const argv = process.argv.slice(2)
  let childId = 0
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--child-id') childId = Number(argv[++i])
  }
  if (!Number.isFinite(childId) || childId < 1) {
    console.error(`[worker-child] invalid --child-id: ${childId} (expected >= 1)`)
    process.exit(2)
  }
  const machineId = getMachineId()
  const processKey = getRedisProcessKey(childId)

  // REDIS_URL is optional; queue.ts falls back to redis://localhost:6379.
  // The ping below is the real gate.
  try {
    await getRedisConnection().ping()
  } catch (err) {
    console.error(
      `[worker-child=${processKey}] redis ping failed at ${process.env.REDIS_URL ?? 'redis://localhost:6379'}:`,
      err,
    )
    process.exit(2)
  }

  // The commit this child LOADED its code at — inherited from the supervisor
  // via WORKER_LAUNCH_SHA. Report this (not live HEAD) so the dashboard shows
  // the code actually running, even after the repo advances on disk.
  const loadedSha = process.env.WORKER_LAUNCH_SHA?.trim() || getCurrentGitSha()
  const loadedBranch = process.env.WORKER_LAUNCH_BRANCH?.trim() || getCurrentGitBranch()
  console.log(`[worker-child=${processKey}] ready branch=${loadedBranch} commitSha=${loadedSha}`)

  const stopHeartbeat = await startHeartbeat(processKey, loadedSha, loadedBranch)
  const processor = makeMarketProcessor({ machineId, workerChildId: childId })
  const w = new Worker(
    MARKET_QUEUE,
    async (job, token) => {
      // processor may throw DelayedError (job released for a self-update) —
      // let it propagate so BullMQ keeps the job delayed instead of failing it.
      try {
        const result = await processor(job, token)
        await recordWorkerStats(processKey, result, result.slug)
        return result
      } catch (err) {
        if (isDelayedJobSignal(err)) requestSupervisorSelfUpdate(processKey)
        throw err
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 1, // CRITICAL: real parallelism comes from N children, not concurrency.
      ...WORKER_OPTS,
    },
  )
  w.on('failed', (job, err) => {
    console.warn(
      `[worker-child=${processKey}] failed jobId=${job?.id ?? '?'} attempt=${job?.attemptsMade ?? '?'} err=${err.message}`,
    )
  })
  w.on('error', (err) => {
    console.error(`[worker-child=${processKey}] error:`, err.message)
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[worker-child=${processKey}] ${signal} draining...`)
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
