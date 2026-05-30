import '../config/env.js'
import os from 'os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, fork, type ChildProcess } from 'node:child_process'
import { Worker } from 'bullmq'
import { requireEnv } from '../config/env.js'
import {
  AGGREGATE_QUEUE,
  WORKER_OPTS,
  closeRedisConnection,
  getRedisConnection,
} from '../backtest/queue.js'
import { aggregateProcessor } from '../backtest/aggregateProcessor.js'
import { defaultWorkerName } from '../backtest/workerIdentity.js'

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
  let workerName = defaultWorkerName()

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

async function startHeartbeat(workerName: string): Promise<() => Promise<void>> {
  const conn = getRedisConnection()
  const interval = 5000
  const write = async (): Promise<void> => {
    try {
      await conn.set(`backtest:worker:${workerName}:heartbeat`, String(Date.now()), 'EX', 60)
      await conn.hset(`backtest:worker:${workerName}`, 'commitSha', getCurrentGitSha())
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

/**
 * Resolves the path to `backtestWorkerChild.ts` next to this file.
 * Works under both tsx (source) and a compiled dist layout.
 */
function resolveChildScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // tsx serves from `src/cli/`; compiled output sits in `dist/cli/` — same dirname relative.
  return path.join(here, 'backtestWorkerChild.ts')
}

/**
 * Fork N single-concurrency market worker children. Each child is its own
 * Node process with its own event loop, so CPU-bound replay work runs in
 * parallel across N cores.
 *
 * Returns disposers + a shutdown hook the supervisor calls on SIGINT/SIGTERM.
 */
function spawnMarketChildren(args: { count: number; workerName: string }): {
  children: ChildProcess[]
  shutdown: (signal: NodeJS.Signals) => Promise<void>
} {
  const childScript = resolveChildScriptPath()
  // tsx is the loader used by `npm run` scripts; we re-use the same interpreter
  // for children so TypeScript files resolve identically.
  const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx')

  const children: ChildProcess[] = []
  for (let i = 0; i < args.count; i += 1) {
    const child = fork(childScript, ['--worker-name', args.workerName, '--child-id', String(i)], {
      execPath: tsxBin,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    child.on('exit', (code, signal) => {
      console.warn(
        `[worker=${args.workerName}] child#${i} exited code=${code} signal=${signal ?? ''}`,
      )
    })
    children.push(child)
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    for (const child of children) {
      try {
        child.kill(signal)
      } catch {
        /* ignore */
      }
    }
    // Wait up to 30s for graceful drain, then SIGKILL stragglers.
    const deadline = Date.now() + 30_000
    while (children.some((c) => c.exitCode === null && !c.killed) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    for (const child of children) {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { children, shutdown }
}

async function main(): Promise<void> {
  checkNodeVersion()
  const args = parseArgs()

  requireEnv(['REDIS_URL'])
  await pingRedis()

  console.log(
    `[worker] starting workerName=${args.workerName} queues=${[...args.queues].join(',')}` +
      ` marketConcurrency=${args.marketConcurrency} aggregateConcurrency=${args.aggregateConcurrency}` +
      ` commitSha=${getCurrentGitSha()}`,
  )

  const stopHeartbeat = await startHeartbeat(args.workerName)
  const inProcessWorkers: Worker[] = []
  let marketChildren: {
    children: ChildProcess[]
    shutdown: (s: NodeJS.Signals) => Promise<void>
  } | null = null

  if (args.queues.has('markets')) {
    // Each child is a fully separate Node process running its own
    // single-concurrency BullMQ Worker. N children -> N cores of real CPU
    // parallelism (BullMQ `concurrency: N` in a single process only gives
    // event-loop concurrency, which serializes CPU-bound work).
    marketChildren = spawnMarketChildren({
      count: args.marketConcurrency,
      workerName: args.workerName,
    })
    console.log(
      `[worker=${args.workerName}] spawned ${marketChildren.children.length} market child process(es)`,
    )
  }

  if (args.queues.has('aggregate')) {
    // Aggregate work is I/O-bound (Redis getChildrenValues + one big MySQL
    // insert) and serial by design (concurrency 1). Running it in-process is
    // fine and avoids another forked Node.
    const w = new Worker(AGGREGATE_QUEUE, aggregateProcessor, {
      connection: getRedisConnection(),
      concurrency: args.aggregateConcurrency,
      ...WORKER_OPTS,
    })
    w.on('completed', (_job, result) => {
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
    inProcessWorkers.push(w)
  }

  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[worker=${args.workerName}] ${signal} received, draining...`)
    await stopHeartbeat()
    await Promise.allSettled([
      ...inProcessWorkers.map((w) => w.close()),
      marketChildren ? marketChildren.shutdown(signal) : Promise.resolve(),
    ])
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
