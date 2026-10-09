/** Real BullMQ workers over isolated queue names on the configured production Redis host. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Worker, type Job } from 'bullmq'
import { config } from 'dotenv'
import { seededRandom, type Manifest } from './common.mjs'
import type { MarketJobData } from '../../src/backtest/jobTypes.js'
import type {
  RunSingleMarketInput,
  RunSingleMarketOutput,
} from '../../src/backtest/runSingleMarket.js'

const [settingsPath, mode, role, idArg, roundDirectory] = process.argv.slice(2)
assert(
  settingsPath &&
    roundDirectory &&
    ['typescript', 'rust'].includes(mode ?? '') &&
    ['market', 'aggregate'].includes(role ?? ''),
)
const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
const manifest: Manifest = JSON.parse(await readFile(settings.manifestPath, 'utf8'))
const root = settings.snapshotRoot as string
config({ path: path.join(root, '.env'), quiet: true })
const load = (name: string) => import(pathToFileURL(path.join(root, name)).href)
const queue = (await load('src/backtest/queue.ts')) as typeof import('../../src/backtest/queue.js')
const identity = (await load(
  'src/backtest/workerIdentity.ts',
)) as typeof import('../../src/backtest/workerIdentity.js')
const id = Number(idArg)
const processKey = settings.namespace + (role === 'market' ? `market-${id}` : 'aggregator')
const stopHeartbeat = await identity.startHeartbeat(
  processKey,
  settings.productionCommit,
  'isolated-rust-benchmark',
  role,
)
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
assert.equal(
  hash(
    await readFile(path.join(root, 'data/strategy-artifacts', manifest.artifactSha256 + '.mjs')),
  ),
  manifest.artifactSha256,
)
const scratch = path.join(roundDirectory, 'bridge-' + id)
await mkdir(scratch, { recursive: true })
let child: ChildProcess | undefined
const runNative = async (input: RunSingleMarketInput): Promise<RunSingleMarketOutput> => {
  const bridgeStartedAt = Date.now()
  const market = manifest.markets.find((m) => m.slug === input.slug)
  assert(market)
  assert.equal(input.inputMode, 'telonex-delta')
  assert.equal(input.order, 'recorded')
  assert.equal(input.timeDriven, false)
  assert.equal(await realpath(path.resolve(root, input.filePath)), await realpath(market.filePath))
  assert.deepEqual(input.marketResolution, {
    tokenMap: { UP: market.upId, DOWN: market.downId },
    outcome: market.outcome,
  })
  assert.equal(input.marketMeta?.upAssetId, market.upId)
  assert.equal(input.marketMeta?.downAssetId, market.downId)
  assert.equal(input.marketMeta?.eventStartTime, new Date(market.startMs).toISOString())
  assert.deepEqual(input.strategyWindow, { startMs: market.startMs, endMs: market.endMs })
  assert.deepEqual(input.gammaPriceToBeat, {
    priceToBeat: market.priceToBeat,
    syncedAtMs: market.gammaSyncedAtMs,
  })
  assert.deepEqual(input.strategyParams, manifest.params)
  assert.equal(input.strategyId, manifest.strategy)
  assert.equal(input.startingCapital, manifest.settings.startingCapital)
  assert.deepEqual(input.latency, {
    delayMs: manifest.settings.delayMs,
    jitterMs: manifest.settings.jitterMs,
  })
  assert(input.strategyDefinition)
  const request = JSON.stringify({ ...manifest, markets: [market] })
  const inputFile = path.join(scratch, 'input.json')
  const outputFile = path.join(scratch, 'output.json')
  await writeFile(inputFile, request)
  await new Promise<void>((resolve, reject) => {
    child = spawn(settings.binary, [inputFile, outputFile, 'no-trace'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RUST_BACKTEST_LOG_EVENTS: '1' },
    })
    let stderr = ''
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      try {
        const item = JSON.parse(line)
        if (item.message === 'feed_summary') {
          const x = item.extra
          const summary = `[backtest:feeds] fulfilled slug=${x.slug}: binanceWsSpotPrice(symbol=btcusdt trades=${x.binanceCount}), rtdsChainlink(symbol=btc/usd rounds=${x.chainlinkCount}), polymarketPriceToBeat(openPrice=${x.priceToBeat}), tickOnUpdate(syntheticTicks=${x.syntheticCount})`
          console.log(summary)
          if (input.r2Fallback) {
            const local = `[read-from] LOCAL hit slug=${input.slug} ${path.resolve(root, input.filePath)}`
            console.log(local)
          }
        } else {
          assert.equal(item.message, '[trade]')
          console.log(item.message, item.extra)
        }
      } catch (error) {
        child?.kill('SIGTERM')
        reject(error)
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      child = undefined
      if (code === 0) resolve()
      else reject(new Error(`Native child failed ${code}: ${stderr}`))
    })
  })
  const native = JSON.parse(await readFile(outputFile, 'utf8'))
  assert.equal(native.manifestSha256, hash(request))
  assert.equal(native.results.length, 1)
  const result = native.results[0]
  assert.equal(result.slug, input.slug)
  result.stats.execution.startedAtMs = bridgeStartedAt
  result.stats.execution.finishedAtMs = Date.now()
  result.stats.execution.durationMs = result.stats.execution.finishedAtMs - bridgeStartedAt
  result.stats.execution.machineId = input.machineId
  result.stats.execution.workerChildId = input.workerChildId
  result.stats.execution.commitSha = input.commitSha
  return {
    idx: input.idx,
    slug: input.slug,
    marketStats: result.stats,
    eventsProcessed: result.eventsProcessed,
    eventsByType: result.eventsByType,
    durationMs: result.stats.execution.durationMs,
    ...(result.stats.skipReason === 'no_in_window_activity'
      ? { skipReason: 'no_activity' as const }
      : {}),
  }
}
let processor: (job: Job, token?: string) => Promise<unknown>
const jobResults: unknown[] = []
const logs: Record<string, unknown[][]> = {}
const timings: unknown[] = []
if (role === 'market') {
  const { makeMarketProcessor } = (await load(
    'src/backtest/marketProcessor.ts',
  )) as typeof import('../../src/backtest/marketProcessor.js')
  const run = makeMarketProcessor({
    machineId: settings.namespace.slice(0, -1),
    workerChildId: id,
    ...(mode === 'rust' ? { runMarket: runNative } : {}),
  })
  processor = async (job, token) => {
    const begin = Date.now()
    const originalRandom = Math.random
    const originalLog = console.log
    const captured: unknown[][] = []
    Math.random = seededRandom(manifest.settings.seed)
    console.log = (...items: unknown[]) => {
      captured.push(items)
      originalLog(...items)
    }
    let result: RunSingleMarketOutput
    try {
      result = await run(job as Job<MarketJobData>, token)
    } finally {
      Math.random = originalRandom
      console.log = originalLog
    }
    const connection = queue.getRedisConnection()
    const pipe = connection.pipeline()
    pipe.hincrby(`${settings.namespace}backtest:worker:${processKey}`, 'processedTotal', 1)
    if (result.eventsProcessed > 0)
      pipe.hincrby(
        `${settings.namespace}backtest:worker:${processKey}`,
        'eventsTotal',
        result.eventsProcessed,
      )
    if (result.slug)
      pipe.hset(`${settings.namespace}backtest:worker:${processKey}`, 'lastMarket', result.slug)
    pipe.hset(
      `${settings.namespace}backtest:worker:${processKey}`,
      'lastFinishedAt',
      String(Date.now()),
    )
    await pipe.exec()
    jobResults.push(result)
    logs[String(result.idx)] = captured
    timings.push({ idx: result.idx, begin, end: Date.now() })
    return result
  }
} else {
  const { aggregateProcessor } = (await load(
    'src/backtest/aggregateProcessor.ts',
  )) as typeof import('../../src/backtest/aggregateProcessor.js')
  processor = async (job) => {
    const begin = Date.now()
    const result = await aggregateProcessor(job)
    const end = Date.now()
    await writeFile(
      path.join(roundDirectory, 'aggregate-complete.json'),
      JSON.stringify({ begin, end, result, insertMeta: job.data.insertMeta }),
    )
    return result
  }
}
const worker = new Worker(
  role === 'market' ? queue.MARKET_QUEUE : queue.AGGREGATE_QUEUE,
  processor,
  { connection: queue.getRedisConnection(), concurrency: 1, ...queue.WORKER_OPTS },
)
worker.on('failed', (job, error) => {
  console.error('BENCHMARK_JOB_FAILURE', job?.id, error.message)
})
worker.on('error', (error) => console.error('BENCHMARK_WORKER_ERROR', error.message))
await worker.waitUntilReady()
await writeFile(path.join(roundDirectory, `${role}-${id}-ready`), 'ready')
let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  await worker.close()
  await stopHeartbeat()
  await writeFile(
    path.join(roundDirectory, `${role}-${id}-results.json`),
    JSON.stringify({ results: jobResults, logs, timings }),
  )
  await queue.closeRedisConnection()
  const { closeDb } = await load('src/db/index.ts')
  await closeDb()
  process.exit(0)
}
process.on('SIGTERM', () => {
  child?.kill('SIGTERM')
  void shutdown()
})
process.on('SIGINT', () => {
  child?.kill('SIGINT')
  void shutdown()
})
