/** Offline audit of the actual production processor; no Queue or Worker is constructed. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { config } from 'dotenv'
import type { Job } from 'bullmq'
import type { MarketJobData } from '../../src/backtest/jobTypes.js'
import type {
  RunSingleMarketInput,
  RunSingleMarketOutput,
} from '../../src/backtest/runSingleMarket.js'
import { marketMeta, seededRandom, type Manifest } from './common.mjs'

const [rootArg, manifestPath, outputPath, mode, binaryPath, workerArg] = process.argv.slice(2)
if (
  !rootArg ||
  !manifestPath ||
  !outputPath ||
  !['typescript', 'rust', 'aggregate'].includes(mode ?? '')
)
  throw new Error(
    'Usage: worker-boundary.mts production-root manifest output typescript|rust|aggregate binary worker-id',
  )
const root = path.resolve(rootArg)
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
if (mode === 'aggregate') {
  const input = JSON.parse(await readFile(manifestPath, 'utf8'))
  const { computeBatchStats } = await import(
    pathToFileURL(path.join(root, 'src/backtest/stats/batchStats.ts')).href
  )
  const { computeBacktestSegments } = await import(
    pathToFileURL(path.join(root, 'src/backtest/stats/backtestSegments.ts')).href
  )
  await writeFile(
    outputPath,
    JSON.stringify({
      batch: computeBatchStats(input.markets, input.initialCapital).toRunColumns(),
      segments: computeBacktestSegments(input.markets, input.initialCapital),
    }),
  )
  process.exit(0)
}
const bytes = await readFile(manifestPath)
const manifest = JSON.parse(bytes.toString()) as Manifest & {
  rawInputSettings: {
    binanceLookbackMs: number
    chainlinkLookbackMs: number
    chainlinkMaxGapMs: number
  }
  auditOriginalIndices?: number[]
}
const workerId = Number(workerArg)
assert(Number.isInteger(workerId) && workerId > 0)
assert(manifest.markets.length > 0)
const cachedArtifact = await readFile(
  path.join(root, 'data/strategy-artifacts', `${manifest.artifactSha256}.mjs`),
)
assert.equal(
  hash(cachedArtifact),
  manifest.artifactSha256,
  'A verified local artifact is required; downloads are not part of this audit',
)
config({ path: path.join(root, '.env') })
const controls: Record<string, string> = {
  BINANCE_DATA_BASE_DIR: path.join(root, 'data/binance'),
  TELONEX_CRYPTO_PRICES_BASE_DIR: path.join(root, 'data/telonex/crypto_prices'),
  BACKTEST_BINANCE_FEED_LATENCY_MS: String(manifest.settings.binanceLatencyMs),
  BACKTEST_RTDS_CHAINLINK_LATENCY_MS: String(manifest.settings.chainlinkLatencyMs),
  BACKTEST_PRICE_TO_BEAT_LATENCY_MS: String(manifest.settings.priceToBeatLatencyMs),
  BACKTEST_BINANCE_FEED_LOOKBACK_MS: String(manifest.rawInputSettings.binanceLookbackMs),
  BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS: String(manifest.rawInputSettings.chainlinkLookbackMs),
  BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS: String(manifest.rawInputSettings.chainlinkMaxGapMs),
  BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS: '0',
  WEB_UI_ORDERBOOK_LEVELS: '10',
}
Object.assign(process.env, controls)
assert(process.env.WORKER_LAUNCH_SHA, 'Runner must bind the current production commit')
console.log = () => {}
const { makeMarketProcessor } = (await import(
  pathToFileURL(path.join(root, 'src/backtest/marketProcessor.ts')).href
)) as typeof import('../../src/backtest/marketProcessor.js')
const scratch = path.join(path.dirname(outputPath), `${path.basename(outputPath)}-bridge`)
await mkdir(scratch, { recursive: true })
const nativeInput = path.join(scratch, 'input.json')
const nativeOutput = path.join(scratch, 'output.json')
const diagnostics: {
  slug: string
  bridgeWallMs: number
  nativeBatchMs: number
  requestBytes: number
  responseBytes: number
}[] = []
let child: ChildProcess | undefined
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    child?.kill(signal)
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
const runNative = async (input: RunSingleMarketInput): Promise<RunSingleMarketOutput> => {
  assert(binaryPath)
  assert.equal(input.inputMode, 'telonex-delta')
  assert.equal(input.order, 'recorded')
  assert.equal(input.timeDriven, false)
  const market = manifest.markets.find((m) => m.slug === input.slug)
  assert(market)
  assert.equal(input.filePath, market.filePath)
  assert.deepEqual(input.marketMeta, marketMeta(market))
  assert.deepEqual(input.marketResolution, {
    tokenMap: { UP: market.upId, DOWN: market.downId },
    outcome: market.outcome,
  })
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
  assert(input.strategyDefinition, 'Production artifact loader must run for native jobs too')
  const begin = performance.now()
  const request = JSON.stringify({ ...manifest, markets: [market] })
  await writeFile(nativeInput, request)
  await new Promise<void>((resolve, reject) => {
    child = spawn(binaryPath, [nativeInput, nativeOutput, 'no-trace'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stdout!.resume()
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192)
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      child = undefined
      if (code === 0) resolve()
      else reject(new Error(`Native child failed code=${code} signal=${signal}: ${stderr}`))
    })
  })
  const response = await readFile(nativeOutput)
  const native = JSON.parse(response.toString())
  assert.equal(native.manifestSha256, hash(request))
  assert.equal(native.trace, false)
  assert.equal(native.mode, 'raw-parquet')
  assert.equal(native.results.length, 1)
  const result = native.results[0]
  assert.equal(result.slug, input.slug)
  diagnostics.push({
    slug: market.slug,
    bridgeWallMs: performance.now() - begin,
    nativeBatchMs: native.durationMs,
    requestBytes: Buffer.byteLength(request),
    responseBytes: response.length,
  })
  result.stats.execution.machineId = input.machineId
  result.stats.execution.workerChildId = input.workerChildId ?? null
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
const processor = makeMarketProcessor({
  machineId: 'rust-experiment',
  workerChildId: workerId,
  ...(mode === 'rust' ? { runMarket: runNative } : {}),
})
const results: RunSingleMarketOutput[] = []
const begin = performance.now()
try {
  for (const [idx, market] of manifest.markets.entries()) {
    const data: MarketJobData = {
      startingCapital: manifest.settings.startingCapital,
      submissionUid: 'offline-boundary-audit',
      batchUid: 'offline-boundary-audit',
      idx: manifest.auditOriginalIndices?.[idx] ?? idx,
      filePath: market.filePath,
      slug: market.slug,
      marketMeta: marketMeta(market),
      marketResolution: {
        tokenMap: { UP: market.upId, DOWN: market.downId },
        outcome: market.outcome,
      },
      strategyId: manifest.strategy,
      strategyParams: manifest.params,
      strategyArtifact: { sha256: manifest.artifactSha256, r2Url: manifest.artifactMeta.r2Url },
      inputMode: 'telonex-delta',
      order: 'recorded',
      timeDriven: false,
      latency: { delayMs: manifest.settings.delayMs, jitterMs: manifest.settings.jitterMs },
      strategyWindow: { startMs: market.startMs, endMs: market.endMs },
      gammaPriceToBeat: { priceToBeat: market.priceToBeat, syncedAtMs: market.gammaSyncedAtMs },
      commitSha: process.env.WORKER_LAUNCH_SHA!,
    }
    // A transport-free job envelope: the real processor receives and maps every field.
    const job = {
      id: `offline-boundary-audit-m-${idx}`,
      data,
      moveToDelayed: async () => {
        throw new Error('Unexpected stale-code gate')
      },
    } as unknown as Job<MarketJobData>
    const originalRandom = Math.random
    Math.random = seededRandom(manifest.settings.seed)
    try {
      results.push(await processor(job))
    } finally {
      Math.random = originalRandom
    }
    if (results.length % 25 === 0) console.error(`Progress: ${results.length} markets`)
  }
  await writeFile(
    outputPath,
    JSON.stringify({
      engine: mode,
      manifestSha256: hash(bytes),
      mode: 'offline-production-processor',
      trace: false,
      workerId,
      productionCommit: process.env.WORKER_LAUNCH_SHA,
      controls,
      durationMs: performance.now() - begin,
      results,
      diagnostics,
    }),
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}
