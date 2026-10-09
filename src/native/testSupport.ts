/**
 * Shared fixtures for the src/native unit tests (not imported by runtime
 * code): a scratch data root laid out like `data/` (00 §5), a TS
 * `MarketJobData` of a BTC 15m market inside Chainlink coverage, and the
 * committed ts-compat default ModelConfig (D57).
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MarketJobData } from '../backtest/jobTypes.js'
import { windowFromSlug } from '../polymarket/upDownSlugWindow.js'
import type { ExternalFeedsRequestConfig } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { modelConfigSha256 } from './contract/canonicalJson.js'
import { candidateModelConfigSha256 } from './contract/echo.js'
import type { ModelConfig } from './contract/generated.js'
import type { NativeMarketJobData } from './buildEngineJob.js'
import { CONTRACT_DIR } from './modelConfig.js'
import { toNativeMarketJob } from './nativeJob.js'

/** 2026-04-19T00:00:00Z: window [00:00, 00:15); lookback reaches 2026-04-18 (14 F-12, F-20). */
export const SLUG = 'btc-updown-15m-1776556800'
export const INPUT_REL = `data/events/telonex/delta-typed/btc/15m/${SLUG}.parquet`
export const INPUT_BYTES = 4096

export const FEEDS_ALL: ExternalFeedsRequestConfig = {
  binanceWsSpotPrice: { tickOnUpdate: true },
  rtdsCryptoPrices: { tickOnUpdate: true },
  polymarketPriceToBeat: { enabled: true },
}

export function tsCompatDefault(): ModelConfig {
  return JSON.parse(
    readFileSync(path.join(CONTRACT_DIR, 'model-configs', 'ts-compat-default.json'), 'utf8'),
  ) as ModelConfig
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `pmb-native-test-${prefix}-`))
}

/** Writes `bytes` bytes at `file`, creating directories. */
export function writeBytes(file: string, bytes: number, fill = 7): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, Buffer.alloc(bytes, fill))
}

/**
 * A data root with the market input and the Binance and Chainlink day files
 * of {@link SLUG}; returns its absolute path.
 */
export function makeDataRoot(opts: { input?: boolean; days?: boolean } = {}): string {
  const root = scratchDir('data')
  if (opts.input !== false)
    writeBytes(path.join(root, INPUT_REL.slice('data/'.length)), INPUT_BYTES)
  if (opts.days !== false) {
    for (const day of ['2026-04-18', '2026-04-19']) {
      writeBytes(
        path.join(root, 'binance', 'aggTrades', 'BTCUSDT', `BTCUSDT-aggTrades-${day}.parquet`),
        100,
      )
      writeBytes(
        path.join(
          root,
          'telonex',
          'crypto_prices',
          'btcusd',
          `btcusd-crypto-prices-${day}.parquet`,
        ),
        200,
      )
    }
  }
  return root
}

/** The TS job the producer builds for {@link SLUG} (`src/cli/backtest.ts`, 60 H-1). */
export function tsJob(over: Partial<MarketJobData> = {}): MarketJobData {
  return {
    startingCapital: 500,
    submissionUid: 'sub-1',
    batchUid: 'batch-1',
    idx: 3,
    filePath: `/abs/${SLUG}.parquet`,
    slug: SLUG,
    marketMeta: undefined,
    marketResolution: { tokenMap: { UP: '111', DOWN: '222' }, outcome: 'UP' },
    strategyId: 'feed-exerciser',
    strategyParams: { trade: false },
    inputMode: 'telonex-delta',
    order: 'recorded',
    timeDriven: false,
    latency: { delayMs: 0, jitterMs: 0 },
    strategyWindow: windowFromSlug(SLUG),
    commitSha: 'abc123',
    gammaPriceToBeat: { priceToBeat: 84123.45, syncedAtMs: 1_776_600_000_000 },
    ...over,
  }
}

/** A native job for {@link SLUG} with every feed requested, read locally. */
export function nativeJob(
  over: Partial<MarketJobData> = {},
  extras: Partial<Parameters<typeof toNativeMarketJob>[1]> = {},
): NativeMarketJobData {
  return toNativeMarketJob(tsJob(over), {
    strategyId: 'feed-exerciser.rs',
    modelConfig: tsCompatDefault(),
    requiredFeeds: FEEDS_ALL,
    conditionId: '0xabc',
    input: {
      path: INPUT_REL,
      r2Url: `r2://bucket/telonex/${SLUG}.parquet`,
      bytes: INPUT_BYTES,
      sha256: null,
      format: { name: 'telonex-delta-typed', version: 1 },
    },
    readFrom: 'local',
    asOfMs: 1_791_500_000_000,
    gate: TEST_GATE,
    ...extras,
  })
}

/** Gate inputs of a test native job (21 §4, 40 §4.1). */
export const TEST_GATE = {
  protocolVersion: 2,
  target: 'aarch64-apple-darwin',
  artifactSha256: 'a'.repeat(64),
  artifactR2Url: `r2://bucket/native/${'a'.repeat(64)}`,
  priorityClass: 'user',
  producerDirty: false,
} as const

/** A contract result fixture rewritten so that it echoes `job` (21 §12). */
export function echoingResult(
  job: import('./contract/generated.js').EngineJob,
  fixture = 'ok-ts-compat.json',
  engineVersion = '0.1.0',
): import('./contract/generated.js').EngineResult {
  const r = JSON.parse(
    readFileSync(path.join(CONTRACT_DIR, 'fixtures', 'results', 'valid', fixture), 'utf8'),
  ) as import('./contract/generated.js').EngineResult
  const mc = job.run.modelConfig
  if (r.echo && r.market) {
    r.echo = {
      ...r.echo,
      engineVersion,
      strategyId: job.run.strategyId,
      jobSchemaVersion: job.jobSchemaVersion,
      profile: mc.profile,
      seed: mc.seed,
      modelConfigSha256: modelConfigSha256(mc),
      rulesTableVersion: mc.rules.rulesTableVersion,
      snapshotParserVersion: job.market.rules.snapshotParserVersion,
    }
    r.market = { ...r.market, slug: job.market.slug }
  }
  if (r.candidates.length > 0) {
    const shas = candidateModelConfigSha256(job)
    r.candidates = job.run.candidates.map((c, i) => {
      const src = r.candidates[i] ?? r.candidates[0]!
      return {
        ...src,
        key: c.key,
        index: c.index,
        modelConfigSha256: shas[i]!,
        ...(src.output ? { output: { ...src.output, slug: job.market.slug } } : {}),
      }
    })
  }
  return r
}

export interface FakeConfig {
  describe?: unknown
  describeExit?: number
  result?: unknown
  runExit?: number
  stderr?: string
  record?: string
  selfKill?: boolean
  bigMiB?: number
}

/** A scripted executable standing in for a native artifact. */
export function fakeBin(cfg: FakeConfig): string {
  const dir = scratchDir('bin')
  const file = path.join(dir, 'fake-native')
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('fs')
const cfg = ${JSON.stringify(cfg)}
const args = process.argv.slice(2)
if (cfg.record) fs.writeFileSync(cfg.record, JSON.stringify({ args, env: process.env, cwd: process.cwd(), job: args[0] === 'run' ? JSON.parse(fs.readFileSync(args[2], 'utf8')) : null }))
if (cfg.stderr) process.stderr.write(cfg.stderr)
if (args[0] === 'describe') {
  process.stdout.write(JSON.stringify(cfg.describe))
  process.exitCode = cfg.describeExit || 0
} else if (args[0] === 'run') {
  if (cfg.selfKill) process.kill(process.pid, 'SIGKILL')
  if (cfg.bigMiB) { const chunk = 'x'.repeat(1 << 20); for (let i = 0; i < cfg.bigMiB; i++) process.stdout.write(chunk) }
  const t = args.indexOf('--trace')
  if (t > 0) fs.writeFileSync(args[t + 1], 'trace')
  if (cfg.result !== undefined) process.stdout.write(typeof cfg.result === 'string' ? cfg.result : JSON.stringify(cfg.result))
  process.exitCode = cfg.runExit || 0
} else {
  process.stderr.write('unknown subcommand\\n')
  process.exitCode = 2
}
`,
  )
  chmodSync(file, 0o755)
  return file
}
