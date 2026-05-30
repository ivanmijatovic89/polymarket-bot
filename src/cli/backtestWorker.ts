import '../config/env.js'
import os from 'os'
import { execSync } from 'node:child_process'
import { Worker } from 'bullmq'
import { requireEnv } from '../config/env.js'
import {
  AGGREGATE_QUEUE,
  MARKET_QUEUE,
  WORKER_OPTS,
  closeRedisConnection,
  getRedisConnection,
} from '../backtest/queue.js'
import { makeMarketProcessor } from '../backtest/marketProcessor.js'
import { aggregateProcessor } from '../backtest/aggregateProcessor.js'

type Queues = 'markets' | 'aggregate'

type Args = {
  queues: Set<Queues>
  marketConcurrency: number
  aggregateConcurrency: number
  workerName: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let queuesStr = 'markets,aggregate'
  let marketConcurrency = Math.max(1, os.cpus().length - 1)
  let aggregateConcurrency = 1
  let workerName = `${os.hostname()}-${process.pid}`

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`missing value for ${a}`)
      return v
    }
    if (a === '--queues') queuesStr = next()
    else if (a === '--market-concurrency') marketConcurrency = Number(next())
    else if (a === '--aggregate-concurrency') aggregateConcurrency = Number(next())
    else if (a === '--worker-name') workerName = next()
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: tsx src/cli/backtestWorker.ts [options]\n' +
          '  --queues markets[,aggregate]   Which queues to consume (default: markets,aggregate)\n' +
          '  --market-concurrency N         Parallel market jobs (default: cpus-1)\n' +
          '  --aggregate-concurrency N      Parallel aggregate jobs (default: 1)\n' +
          '  --worker-name <name>           Display name (default: <hostname>-<pid>)\n',
      )
      process.exit(0)
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }

  const queues = new Set<Queues>()
  for (const q of queuesStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (q !== 'markets' && q !== 'aggregate') throw new Error(`unknown queue: ${q}`)
    queues.add(q)
  }
  if (queues.size === 0)
    throw new Error('--queues must include at least one of: markets, aggregate')
  if (!Number.isFinite(marketConcurrency) || marketConcurrency < 1) {
    throw new Error(`invalid --market-concurrency: ${marketConcurrency}`)
  }
  if (!Number.isFinite(aggregateConcurrency) || aggregateConcurrency < 1) {
    throw new Error(`invalid --aggregate-concurrency: ${aggregateConcurrency}`)
  }
  return { queues, marketConcurrency, aggregateConcurrency, workerName }
}

function checkNodeVersion(): void {
  // Match `engines.node` (currently ">=20 <21") declared in package.json.
  const major = Number(process.versions.node.split('.')[0])
  if (!Number.isFinite(major) || major < 20 || major >= 21) {
    console.error(
      `[worker] node version mismatch: have ${process.version}, expected ">=20 <21".\n` +
        `Use nvm or Volta to install the right runtime.`,
    )
    process.exit(2)
  }
}

function getCurrentGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

async function pingRedis(): Promise<void> {
  const conn = getRedisConnection()
  try {
    await conn.ping()
  } catch (err) {
    console.error(
      `[worker] Redis ping failed at ${process.env.REDIS_URL ?? 'redis://localhost:6379'}:`,
      err,
    )
    process.exit(2)
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
    // best-effort; never fail a job because we couldn't update stats
  }
}

async function startHeartbeat(workerName: string): Promise<() => Promise<void>> {
  const conn = getRedisConnection()
  const interval = 5000
  const write = async (): Promise<void> => {
    try {
      await conn.set(`backtest:worker:${workerName}:heartbeat`, String(Date.now()), 'EX', 60)
      await conn.hset(
        `backtest:worker:${workerName}`,
        'host',
        os.hostname(),
        'commitSha',
        getCurrentGitSha(),
      )
    } catch {
      /* best-effort */
    }
  }
  await write()
  const timer = setInterval(write, interval)
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
  checkNodeVersion()
  const args = parseArgs()

  // REDIS_URL is the only hard requirement; aggregate workers additionally
  // need DATABASE_* but the existing env loader already handles that via
  // src/db/index.ts when the aggregate processor first runs.
  requireEnv(['REDIS_URL'])

  await pingRedis()

  console.log(
    `[worker] starting workerName=${args.workerName} queues=${[...args.queues].join(',')}` +
      ` marketConcurrency=${args.marketConcurrency} aggregateConcurrency=${args.aggregateConcurrency}` +
      ` commitSha=${getCurrentGitSha()}`,
  )

  const stopHeartbeat = await startHeartbeat(args.workerName)
  const workers: Worker[] = []

  if (args.queues.has('markets')) {
    const processor = makeMarketProcessor(args.workerName)
    const w = new Worker(
      MARKET_QUEUE,
      async (job) => {
        const result = await processor(job)
        await recordWorkerStats(args.workerName, result, result.slug)
        return result
      },
      {
        connection: getRedisConnection(),
        concurrency: args.marketConcurrency,
        ...WORKER_OPTS,
      },
    )
    w.on('failed', (job, err) => {
      console.warn(
        `[worker=${args.workerName}] failed jobId=${job?.id ?? '?'} attempt=${job?.attemptsMade ?? '?'} err=${err.message}`,
      )
    })
    w.on('error', (err) => {
      console.error(`[worker=${args.workerName}] market worker error:`, err.message)
    })
    workers.push(w)
  }

  if (args.queues.has('aggregate')) {
    const w = new Worker(AGGREGATE_QUEUE, aggregateProcessor, {
      connection: getRedisConnection(),
      concurrency: args.aggregateConcurrency,
      ...WORKER_OPTS,
    })
    w.on('completed', (job, result) => {
      const r = result as { batchUid?: string; totalSucceeded?: number; totalFailed?: number }
      console.log(
        `[worker=${args.workerName}] aggregate done batchUid=${r?.batchUid ?? '?'}` +
          ` succeeded=${r?.totalSucceeded ?? 0} failed=${r?.totalFailed ?? 0}`,
      )
    })
    w.on('failed', (job, err) => {
      console.warn(
        `[worker=${args.workerName}] aggregate failed jobId=${job?.id ?? '?'} err=${err.message}`,
      )
    })
    w.on('error', (err) => {
      console.error(`[worker=${args.workerName}] aggregate worker error:`, err.message)
    })
    workers.push(w)
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[worker=${args.workerName}] ${signal} received, draining...`)
    await stopHeartbeat()
    await Promise.allSettled(workers.map((w) => w.close()))
    await closeRedisConnection()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  console.log(`[worker=${args.workerName}] ready`)
}

main().catch((err) => {
  console.error('[worker] startup failed:', err)
  process.exit(1)
})
