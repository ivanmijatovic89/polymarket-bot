import assert from 'node:assert/strict'
import test from 'node:test'
import { planExtension } from './extendPlanner.js'
import type { ExtensibleRun } from '../db/backtests.js'
import {
  captureMarketMetadata,
  type ResolvedCapturePackage,
} from '../recorder-v4/replay/package.js'
import { eligibleManifest } from '../recorder-v4/replay/selectionFixtures.js'
import type { ResolveStrategyResult } from '../cli/helpers/strategyArgs.js'

function parent(): ExtensibleRun {
  return {
    id: 1,
    batchUid: 'parent',
    protocol: null,
    model: null,
    cmd: 'npm run backtest -- --starting-capital 500',
    strategy: 'fixture',
    params: { size: 2 },
    strategyArtifactSha256: null,
    strategyArtifactMeta: null,
    symbol: 'btc',
    timeframe: '5m',
    inputMode: 'recorder-v4',
    converter: 'recorder-v4',
    readFrom: 'r2',
    capitalInitial: 1000,
    comment: null,
    extendingAt: null,
    feedEligibility: null,
    recorderV4Selection: {
      version: 1,
      source: { kind: 'r2', bucket: 'fixture', prefix: 'recorder-v4' },
      requiredFeeds: {},
      allowGaps: false,
      filters: { symbol: 'btc', fromMs: 301_000, toMs: 601_000 },
      summary: { candidates: 1, eligible: 1, selected: 1, excluded: 0, exclusions: {} },
    },
  }
}

function capture(startMs: number): ResolvedCapturePackage {
  const manifest = eligibleManifest(startMs)
  return {
    manifest,
    filePath: `r2://fixture/${manifest.events.key}`,
    marketMeta: captureMarketMetadata(manifest),
    marketResolution: { tokenMap: { UP: 'up', DOWN: 'down' }, outcome: 'UP' },
  }
}

function dependencies(run = parent()) {
  return {
    getRunForExtension: async () => ({ kind: 'ok' as const, run }),
    getCoveredSlugsForRun: async () => new Set([capture(301_000).manifest.market.slug]),
    getCoveredRangeForRun: async () => ({ minMs: 301_000, maxMs: 301_000 }),
    buildStrategyFromConfig: (args: {
      strategyId: string
      rawParams: Record<string, unknown>
    }): ResolveStrategyResult => {
      assert.equal(args.strategyId, run.strategy)
      assert.deepEqual(args.rawParams, run.params)
      return {
        strategyId: run.strategy,
        params: run.params,
        strategy: { name: 'fixture', onMarketTick: () => [], onAccountEvent: () => [] },
      }
    },
    discoverCapturePackages: async (source: unknown, filters: unknown) => {
      assert.deepEqual(source, run.recorderV4Selection!.source)
      assert.deepEqual(
        filters,
        run.recorderV4Selection!.filters.timeframe
          ? { timeframe: run.recorderV4Selection!.filters.timeframe }
          : {},
      )
      return [capture(1_000), capture(301_000), capture(601_000), capture(901_000)]
    },
  }
}

test('V4 extension inherits source and params, anchors backward/forward, and never repeats covered markets', async () => {
  const backward = await planExtension({ parentRunId: 1, limit: 1 }, dependencies())
  assert.equal(backward.kind, 'ok')
  if (backward.kind !== 'ok') return
  assert.deepEqual(
    backward.plan.captureCandidates!.map((pkg) => pkg.manifest.market.startMs),
    [1_000],
  )
  assert.equal(backward.plan.feedEligibility, null)
  const forward = await planExtension({ parentRunId: 1, latest: true, limit: 1 }, dependencies())
  assert.equal(forward.kind, 'ok')
  if (forward.kind !== 'ok') return
  assert.deepEqual(
    forward.plan.captureCandidates!.map((pkg) => pkg.manifest.market.startMs),
    [601_000],
  )
})

test('mixed V4 extension preserves both durations and explicit range overrides the original range', async () => {
  const run = parent()
  run.timeframe = 'mixed'
  const result = await planExtension(
    { parentRunId: 1, fromMs: 601_000, toMs: 901_000 },
    dependencies(run),
  )
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.plan.direction, 'explicit-range')
  assert.deepEqual(
    result.plan.captureCandidates!.map((pkg) => pkg.manifest.market.startMs),
    [601_000, 901_000],
  )
  assert.equal(result.plan.recorderV4Selection!.filters.timeframe, undefined)
})

test('V4 extension fails on shortfall or missing original selection evidence before dispatch', async () => {
  await assert.rejects(planExtension({ parentRunId: 1, limit: 2 }, dependencies()), /shortfall/)
  const preview = await planExtension({ parentRunId: 1, limit: 2, preview: true }, dependencies())
  assert.equal(preview.kind, 'ok')
  if (preview.kind === 'ok') assert.equal(preview.plan.captureCandidates!.length, 1)
  const run = parent()
  run.recorderV4Selection = null
  await assert.rejects(
    planExtension({ parentRunId: 1 }, dependencies(run)),
    /original selection metadata/,
  )
})

test('a limited five-minute result does not narrow an originally unfiltered V4 universe', async () => {
  const run = parent()
  const fifteen = capture(601_000)
  fifteen.manifest.market.timeframe = '15m'
  fifteen.manifest.market.slug = 'btc-updown-15m-601'
  fifteen.manifest.market.endMs = 1_501_000
  fifteen.manifest.coverage.endedAtMs = 1_501_000
  const result = await planExtension(
    { parentRunId: 1, latest: true, limit: 1 },
    {
      ...dependencies(run),
      discoverCapturePackages: async (_source, filters) => {
        assert.deepEqual(filters, {})
        return [capture(301_000), fifteen]
      },
    },
  )
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.plan.captureCandidates![0]!.manifest.market.timeframe, '15m')
})

test('historical parent eligibility continues to use the Telonex planner', async () => {
  const run = parent()
  run.inputMode = 'telonex-delta'
  run.converter = 'delta-typed'
  run.readFrom = 'local'
  let queried = false
  const result = await planExtension(
    { parentRunId: 1 },
    {
      ...dependencies(run),
      selectEligibleTelonexMarkets: async (options) => {
        queried = true
        assert.equal(options.converter, 'delta-typed')
        assert.equal(options.toMs, 300_999)
        return {
          markets: [],
          shortfall: 0,
          summary: {
            total: 0,
            eligible: 0,
            binanceUnusable: 0,
            binanceUnverified: 0,
            chainlinkUnusable: 0,
            chainlinkUnverified: 0,
            priceToBeatMissing: 0,
          },
        }
      },
    },
  )
  assert.equal(queried, true)
  assert.equal(result.kind, 'nothing-to-extend')
})
