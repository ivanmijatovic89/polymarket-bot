import '../config/env.js'
import os from 'os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, type ChildProcess } from 'node:child_process'
import { DelayedError, Worker } from 'bullmq'
import {
  AGGREGATE_QUEUE,
  WORKER_OPTS,
  closeRedisConnection,
  getRedisConnection,
} from '../backtest/queue.js'
import { aggregateProcessor } from '../backtest/aggregateProcessor.js'
import {
  getCurrentGitBranch,
  getCurrentGitSha,
  getMachineId,
  getRedisProcessKey,
  startHeartbeat,
} from '../backtest/workerIdentity.js'
import {
  WORKER_LAUNCH_SHA,
  SELF_UPDATE_EXIT_CODE,
  STALE_JOB_RELEASE_DELAY_MS,
  canRunJobCommit,
} from '../backtest/commitGate.js'

type Queues = 'markets' | 'aggregate'

type MarketChildrenShutdownOptions = {
  forceAfterMs?: number | null
}

type Args = {
  queues: Set<Queues>
  marketConcurrency: number
  aggregateConcurrency: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let queuesStr = 'markets,aggregate'
  let marketConcurrency = Math.max(1, os.cpus().length - 1)
  let aggregateConcurrency = 1

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
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: tsx src/cli/backtestWorker.ts [options]\n' +
          '  --queues markets[,aggregate]   Which queues to consume (default: markets,aggregate)\n' +
          '  --market-concurrency N         Parallel market jobs (default: cpus-1)\n' +
          '  --aggregate-concurrency N      Parallel aggregate jobs (default: 1)\n',
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
  return { queues, marketConcurrency, aggregateConcurrency }
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

/**
 * Resolves the path to `backtestWorkerChild.ts` next to this file.
 * Works under both tsx (source) and a compiled dist layout.
 */
function resolveChildScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // tsx serves from `src/cli/`; compiled output sits in `dist/cli/` — same dirname relative.
  return path.join(here, 'backtestWorkerChild.ts')
}

function isChildRunning(child: ChildProcess): boolean {
  // `child.killed` only means a signal was sent, not that the process exited.
  // Wait on the actual exit state so graceful BullMQ Worker.close() can finish
  // the active job and release its lock before the supervisor self-updates.
  return child.exitCode === null && child.signalCode === null
}

/**
 * Fork N single-concurrency market worker children. Each child is its own
 * Node process with its own event loop, so CPU-bound replay work runs in
 * parallel across N cores.
 */
function spawnMarketChildren(args: {
  count: number
  machineId: string
  onUpdateRequested: () => void
}): {
  children: ChildProcess[]
  shutdown: (signal: NodeJS.Signals, opts?: MarketChildrenShutdownOptions) => Promise<void>
} {
  const childScript = resolveChildScriptPath()
  // tsx is the loader used by `npm run` scripts; we re-use the same interpreter
  // for children so TypeScript files resolve identically.
  const tsxBin = path.resolve(
    process.cwd(),
    process.platform === 'win32' ? 'node_modules/.bin/tsx.cmd' : 'node_modules/.bin/tsx',
  )

  const children: ChildProcess[] = []
  // Children are numbered 1..N for human-readable display.
  for (let i = 1; i <= args.count; i += 1) {
    const child = fork(childScript, ['--child-id', String(i)], {
      execPath: tsxBin,
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    child.on('exit', (code, signal) => {
      console.warn(
        `[worker=${args.machineId}] child#${i} exited code=${code} signal=${signal ?? ''}`,
      )
      if (code === SELF_UPDATE_EXIT_CODE) args.onUpdateRequested()
    })
    child.on('message', (msg: unknown) => {
      if (
        msg &&
        typeof msg === 'object' &&
        (msg as { type?: string }).type === 'update-requested'
      ) {
        args.onUpdateRequested()
      }
    })
    children.push(child)
  }

  const shutdown = async (
    signal: NodeJS.Signals,
    opts: MarketChildrenShutdownOptions = {},
  ): Promise<void> => {
    const forceAfterMs = opts.forceAfterMs === undefined ? 30_000 : opts.forceAfterMs
    for (const child of children) {
      try {
        child.kill(signal)
      } catch {
        /* ignore */
      }
    }
    const deadline = forceAfterMs === null ? Number.POSITIVE_INFINITY : Date.now() + forceAfterMs
    while (children.some(isChildRunning) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    if (forceAfterMs === null) return
    for (const child of children) {
      if (isChildRunning(child)) {
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
  const machineId = getMachineId()
  // Two `backtest:worker` processes can run on the same machine — one that
  // owns the markets queue (with N forked children) and one that owns only
  // the aggregate queue. Give them distinct Redis keys so they don't
  // overwrite each other's heartbeat / counters.
  const supervisorRole: 'supervisor' | 'aggregator' = args.queues.has('markets')
    ? 'supervisor'
    : 'aggregator'
  const supervisorKey = getRedisProcessKey(supervisorRole)

  // The commit this supervisor (and therefore its forked children) loaded its
  // code at. Stamp it into the env so children compare jobs against the code
  // they actually loaded, not a live `git rev-parse` that drifts when files
  // change on disk under a running worker.
  const launchSha = getCurrentGitSha()
  const launchBranch = getCurrentGitBranch()
  process.env.WORKER_LAUNCH_SHA = launchSha
  process.env.WORKER_LAUNCH_BRANCH = launchBranch

  // Note: REDIS_URL is OPTIONAL — getRedisConnection() in queue.ts falls back
  // to redis://localhost:6379 when unset, matching what the producer does.
  await pingRedis()

  console.log(
    `[worker] starting machineId=${machineId} queues=${[...args.queues].join(',')}` +
      ` marketConcurrency=${args.marketConcurrency} aggregateConcurrency=${args.aggregateConcurrency}` +
      ` branch=${launchBranch} commitSha=${launchSha}`,
  )

  const stopHeartbeat = await startHeartbeat(supervisorKey, launchSha, launchBranch)
  const inProcessWorkers: Worker[] = []
  let marketChildren: {
    children: ChildProcess[]
    shutdown: (s: NodeJS.Signals, opts?: MarketChildrenShutdownOptions) => Promise<void>
  } | null = null

  // Shared drain used by both graceful shutdown (exit 0) and self-update
  // (exit SELF_UPDATE_EXIT_CODE — the run-worker.sh wrapper pulls + relaunches).
  let stopping = false
  const drainAndExit = async (
    signal: NodeJS.Signals,
    exitCode: number,
    opts: { forceMarketChildrenAfterMs?: number | null } = {},
  ): Promise<void> => {
    if (stopping) return
    stopping = true
    await stopHeartbeat()
    const marketShutdownOpts: MarketChildrenShutdownOptions = {}
    if ('forceMarketChildrenAfterMs' in opts) {
      marketShutdownOpts.forceAfterMs = opts.forceMarketChildrenAfterMs
    }
    await Promise.allSettled([
      ...inProcessWorkers.map((w) => w.close()),
      marketChildren ? marketChildren.shutdown(signal, marketShutdownOpts) : Promise.resolve(),
    ])
    await closeRedisConnection()
    process.exit(exitCode)
  }

  // A child reported a job built on newer code than we loaded. Drain and exit
  // with the wrapper's update code so it pulls the new commit and relaunches.
  const requestSelfUpdate = (): void => {
    if (stopping) return
    console.log(
      `[worker=${machineId}] stale code detected — draining and exiting ` +
        `${SELF_UPDATE_EXIT_CODE} for self-update`,
    )
    void drainAndExit('SIGTERM', SELF_UPDATE_EXIT_CODE, { forceMarketChildrenAfterMs: null })
  }

  if (args.queues.has('markets')) {
    marketChildren = spawnMarketChildren({
      count: args.marketConcurrency,
      machineId,
      onUpdateRequested: requestSelfUpdate,
    })
    console.log(
      `[worker=${machineId}] spawned ${marketChildren.children.length} market child process(es)`,
    )
  }

  if (args.queues.has('aggregate')) {
    const w = new Worker(
      AGGREGATE_QUEUE,
      async (job, token) => {
        // Same commit gate as market jobs: if the aggregate job was built on
        // newer code than we loaded, release it (no attempt consumed) and ask
        // the supervisor to self-update, rather than aggregating with stale
        // stats/engine code.
        if (!canRunJobCommit(job.data.commitSha)) {
          await job.moveToDelayed(Date.now() + STALE_JOB_RELEASE_DELAY_MS, token)
          console.log(
            `[worker=${machineId}] deferring aggregate job ${job.id} and requesting update: ` +
              `loaded ${WORKER_LAUNCH_SHA.slice(0, 8)}, job needs ${(job.data.commitSha ?? '').slice(0, 8)}`,
          )
          requestSelfUpdate()
          throw new DelayedError()
        }
        return aggregateProcessor(job)
      },
      {
        connection: getRedisConnection(),
        concurrency: args.aggregateConcurrency,
        ...WORKER_OPTS,
      },
    )
    w.on('completed', (_job, result) => {
      const r = result as { batchUid?: string; totalSucceeded?: number; totalFailed?: number }
      console.log(
        `[worker=${machineId}] aggregate done batchUid=${r?.batchUid ?? '?'}` +
          ` succeeded=${r?.totalSucceeded ?? 0} failed=${r?.totalFailed ?? 0}`,
      )
    })
    w.on('failed', (job, err) => {
      console.warn(
        `[worker=${machineId}] aggregate failed jobId=${job?.id ?? '?'} err=${err.message}`,
      )
    })
    w.on('error', (err) => {
      console.error(`[worker=${machineId}] aggregate worker error:`, err.message)
    })
    inProcessWorkers.push(w)
  }

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`[worker=${machineId}] ${signal} received, draining...`)
    void drainAndExit(signal, 0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  console.log(`[worker=${machineId}] ready`)
}

main().catch((err) => {
  console.error('[worker] startup failed:', err)
  process.exit(1)
})
