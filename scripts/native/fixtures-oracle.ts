/**
 * TS oracle child of the fixture-market proof (native/spec/60 §12 FX-2).
 *
 *   tsx scripts/native/fixtures-oracle.ts <request.json>
 *
 * Spawned by `fixtures-build.ts` with the OR-7 environment only (60 §2.3:
 * PATH, HOME, TZ=UTC, the data-root variables and every result-affecting knob
 * set from the committed ts-compat ModelConfig; BOT_ENV unset). Runs
 * `runSingleMarket` (backtest mode, telonex-delta, no persistence) with an
 * observer that hashes, per strategy tick (real and synthetic), the event
 * type, exchange time, local time and the full `ctx.plugins.externalFeeds`
 * snapshot, plus every decision and account event, and the per-market output
 * without wall-clock fields. Writes the result JSON to `request.outFile`.
 *
 * Interim (README "FX-2 proof"): the strategies are feed probes without
 * intents, until the TS feed-exerciser twin and trace writer v2 exist.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import * as z from 'zod'
import { runSingleMarket, type RunSingleMarketInput } from '../../src/backtest/runSingleMarket.js'
import { isSyntheticFeedTick } from '../../src/market/syntheticTick.js'
import { ExternalFeedsRequestPlugin } from '../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { StrategyDefinition } from '../../src/strategy/strategyDefinition.js'
import { definition as feedsParityProbe } from '../../src/strategies/feedsParityProbe.v1.js'

/**
 * Feed probe for markets before Chainlink coverage, where every existing
 * all-feeds TS strategy hard-errors by policy (14 F-19). Same shape as
 * feedsParityProbe.v1 minus Chainlink: Binance + price to beat, no intents.
 * Replaced by the TS feed-exerciser twin (60 §5.8, `chainlink: false`).
 */
const ProbeSchema = z.strictObject({
  tickOnUpdate: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
})
const preCoverageProbe: StrategyDefinition<z.infer<typeof ProbeSchema>> = {
  id: 'fixtures-feed-probe.binance-ptb',
  schema: ProbeSchema,
  create: (cfg) => ({
    strategy: {
      name: 'fixtures-feed-probe.binance-ptb',
      onMarketTick: () => [],
      onAccountEvent: () => [],
    },
    plugins: [
      new ExternalFeedsRequestPlugin({
        binanceWsSpotPrice: cfg.tickOnUpdate ? { tickOnUpdate: true } : {},
        polymarketPriceToBeat: { enabled: true },
      }),
    ],
  }),
}

const STRATEGIES: Record<string, StrategyDefinition<unknown>> = {
  [feedsParityProbe.id]: feedsParityProbe as StrategyDefinition<unknown>,
  [preCoverageProbe.id]: preCoverageProbe as StrategyDefinition<unknown>,
}

const OracleRequestSchema = z.strictObject({
  telonexFile: z.string(),
  slug: z.string(),
  tokenIds: z.strictObject({ UP: z.string(), DOWN: z.string() }),
  outcome: z.enum(['UP', 'DOWN']),
  window: z.strictObject({ startMs: z.number(), endMs: z.number() }),
  priceToBeat: z.strictObject({ value: z.number().nullable(), syncedAtMs: z.number().nullable() }),
  strategyId: z.string(),
  tickOnUpdate: z.boolean(),
  startingCapital: z.number().positive(),
  latency: z.strictObject({ delayMs: z.number().int().min(0), jitterMs: z.literal(0) }),
  outFile: z.string(),
})

const replacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v)

async function main(): Promise<void> {
  const [requestFile, ...extra] = process.argv.slice(2)
  if (!requestFile || extra.length > 0) throw new Error('usage: fixtures-oracle.ts <request.json>')
  // OR-7: the parent must have stripped the environment.
  if (process.env.BOT_ENV !== undefined) throw new Error('OR-7: BOT_ENV must be unset')
  if (process.env.TZ !== 'UTC') throw new Error('OR-7: TZ must be UTC')
  const req = OracleRequestSchema.parse(JSON.parse(readFileSync(requestFile, 'utf8')))
  const definition = STRATEGIES[req.strategyId]
  if (!definition) throw new Error(`unknown proof strategy ${req.strategyId}`)
  const params = definition.schema.parse({ tickOnUpdate: req.tickOnUpdate }) as Record<
    string,
    unknown
  >

  const hash = createHash('sha256')
  let lines = 0
  let ticks = 0
  let syntheticTicks = 0
  let tick: { kind: string; ts: number; local: number | null; feeds: string } | null = null
  const emit = (line: string): void => {
    hash.update(line)
    hash.update('\n')
    lines += 1
  }
  const observer: NonNullable<RunSingleMarketInput['observer']> = {
    onTickStart: (t) => {
      ticks += 1
      if (isSyntheticFeedTick(t.msg)) syntheticTicks += 1
      tick = {
        kind: t.msg.event_type,
        ts: t.snapshot.timestamp,
        local: t.source.kind === 'parquet' ? (t.source.tsLocalMs ?? null) : null,
        feeds: 'null',
      }
    },
    onContext: (ctx) => {
      // Serialize at once: the provider may hand out a mutable view.
      if (tick) tick.feeds = JSON.stringify(ctx?.plugins?.['externalFeeds'] ?? null, replacer)
    },
    onDecision: (origin, intents) => emit(JSON.stringify({ decision: origin, intents }, replacer)),
    onAccountEvent: (event) => emit(JSON.stringify({ account: event }, replacer)),
    onTickEnd: () => {
      if (!tick) return
      emit(
        `{"tick":${JSON.stringify(tick.kind)},"ts":${tick.ts},"local":${tick.local},"feeds":${tick.feeds}}`,
      )
      tick = null
    },
  }
  const out = await runSingleMarket({
    idx: 0,
    filePath: req.telonexFile,
    slug: req.slug,
    marketMeta: undefined,
    marketResolution: { tokenMap: req.tokenIds, outcome: req.outcome },
    strategyId: definition.id,
    strategyParams: params,
    strategyDefinition: definition,
    inputMode: 'telonex-delta',
    order: 'recorded',
    timeDriven: false,
    latency: req.latency,
    startingCapital: req.startingCapital,
    strategyWindow: req.window,
    machineId: 'fixtures-oracle',
    commitSha: 'fixtures-oracle',
    gammaPriceToBeat: {
      priceToBeat: req.priceToBeat.value,
      syncedAtMs: req.priceToBeat.syncedAtMs,
    },
    observer,
  })
  const stats = out.marketStats ? { ...out.marketStats, execution: null } : null
  const outputText = JSON.stringify(
    {
      marketStats: stats,
      eventsProcessed: out.eventsProcessed,
      eventsByType: out.eventsByType,
      skipReason: out.skipReason ?? null,
    },
    replacer,
  )
  writeFileSync(
    req.outFile,
    JSON.stringify({
      strategyId: definition.id,
      params: { tickOnUpdate: req.tickOnUpdate },
      traceSha256: hash.digest('hex'),
      traceLines: lines,
      ticks,
      syntheticTicks,
      outputSha256: createHash('sha256').update(outputText).digest('hex'),
    }),
  )
}

await main()
