/**
 * Golden generator for the stats contract, the skip taxonomy, `intentMeta`
 * and `eventsByType` (60 §7.1 GF-1/GF-2, §7.2; 21 §11-§16). Successor of the
 * WIP `native/crates/pmb-core/tests/fixtures/stats_gen.ts` (fef5f199).
 *
 * For each case it writes a small crafted telonex-delta file
 * (`typedDeltaMarketEventParquetSchema`, the converter's schema) and runs the
 * real TS `runSingleMarket` over it with an inline scripted strategy (the
 * `strategyDefinition` seam), ts-compat execution (`BacktestExecution`) and
 * the slug window. The golden records the script and the TS output minus the
 * fields TS stamps (`execution`, `durationMs`, `idx`; 21 §11-§12).
 *
 * Script semantics (shared with the Rust test): `tick` is the 0-based index
 * of the strategy's `onMarketTick` calls (in-window ticks, 21 §1.1); at that
 * tick the strategy returns the listed intents in order. Account callbacks
 * return nothing.
 *
 * Output: native/fixtures/golden/stats/stats_golden.json and one
 * <case>.parquet per case, deterministic (sorted keys, no timestamps).
 * `header.contentPin` is the oracle pin (60 OR-1, `git merge-base HEAD
 * origin/main`) at which `content` last changed; an unchanged content keeps
 * the previous pin (GF-2).
 *
 * Usage (repo root): npx tsx native/fixtures/gen/stats_gen.ts
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as parquet from '@dsnp/parquetjs'
import * as prettier from 'prettier'
import { z } from 'zod'
import { typedDeltaMarketEventParquetSchema } from '../../../src/parquet/io/eventSchema.js'
import { runSingleMarket } from '../../../src/backtest/runSingleMarket.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import type { Intent, Strategy } from '../../../src/strategy/Strategy.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const outDir = path.join(repoRoot, 'native/fixtures/golden/stats')
const generatorRel = 'native/fixtures/gen/stats_gen.ts'

/** btc 15m window of the fixture slug (10 §5). */
const SLUG = 'btc-updown-15m-1780272000'
const S = 1_780_272_000_000
const WINDOW = { startMs: S, endMs: S + 900_000 }
const CONDITION = '0x' + 'ab'.repeat(32)
const TOKENS = { UP: '1001', DOWN: '2002' } as const

type Out = 'UP' | 'DOWN'
type Lv = [string, string]
type Row =
  | { ts: number | null; type: 'book'; asset: Out; bids: Lv[]; asks: Lv[] }
  | {
      ts: number | null
      type: 'price_change'
      changes: Array<{ asset: Out; side: 'BUY' | 'SELL'; price: string; size: string }>
    }
type ScriptIntent =
  | {
      kind: 'place'
      cid: string
      outcome: Out
      side: 'BUY' | 'SELL'
      price: string
      size: string
      orderType: 'GTC' | 'FOK'
      postOnly?: boolean
      meta?: Record<string, number | string | boolean>
    }
  | { kind: 'cancel'; cid: string }
  | { kind: 'split'; size: string }
type Case = {
  name: string
  what: string
  outcome: Out
  latency: { delayMs: number; jitterMs: number }
  rows: Row[]
  script: Array<{ tick: number; intents: ScriptIntent[] }>
}

const book = (ts: number, asset: Out, bids: Lv[], asks: Lv[]): Row => ({
  ts,
  type: 'book',
  asset,
  bids,
  asks,
})
const pc = (ts: number, ...changes: Array<[Out, 'BUY' | 'SELL', string, string]>): Row => ({
  ts,
  type: 'price_change',
  changes: changes.map(([asset, side, price, size]) => ({ asset, side, price, size })),
})

const UP_BOOK: [Lv[], Lv[]] = [
  [
    ['0.45', '100'],
    ['0.44', '200'],
  ],
  [
    ['0.47', '50'],
    ['0.48', '100'],
    ['0.5', '300'],
  ],
]
const DOWN_BOOK: [Lv[], Lv[]] = [
  [
    ['0.52', '100'],
    ['0.51', '200'],
  ],
  [
    ['0.54', '50'],
    ['0.55', '100'],
  ],
]

/** A DOWN book whose bids stay below the asks the latency case adds. */
const DOWN_BOOK_LOW: [Lv[], Lv[]] = [
  [
    ['0.4', '100'],
    ['0.39', '200'],
  ],
  DOWN_BOOK[1],
]

const cases: Case[] = [
  {
    name: 'activity',
    what: 'taker walk over two levels (one meta entry per cid), resting maker BUY filled by trade-through, a resting order canceled, a taker SELL without meta, a split, an unfilled order with meta at the inclusive window end, counted out-of-window rows',
    outcome: 'UP',
    latency: { delayMs: 0, jitterMs: 0 },
    rows: [
      book(S - 60_000, 'UP', ...UP_BOOK),
      book(S - 60_000, 'DOWN', ...DOWN_BOOK),
      pc(S - 30_000, ['UP', 'BUY', '0.46', '30']),
      pc(S + 1_000, ['UP', 'SELL', '0.47', '60']),
      book(S + 2_000, 'DOWN', ...DOWN_BOOK),
      pc(
        S + 3_000,
        ['DOWN', 'BUY', '0.52', '0'],
        ['DOWN', 'BUY', '0.51', '0'],
        ['DOWN', 'SELL', '0.39', '40'],
      ),
      pc(S + 4_000, ['UP', 'BUY', '0.46', '0']),
      pc(S + 899_000, ['UP', 'SELL', '0.47', '10']),
      pc(S + 900_000, ['UP', 'SELL', '0.47', '15']),
      book(S + 960_000, 'UP', ...UP_BOOK),
    ],
    script: [
      {
        tick: 0,
        intents: [
          {
            kind: 'place',
            cid: 't1',
            outcome: 'UP',
            side: 'BUY',
            price: '0.48',
            size: '80',
            orderType: 'GTC',
            meta: { k: 1, edge: 0.0412 },
          },
          {
            kind: 'place',
            cid: 'm1',
            outcome: 'DOWN',
            side: 'BUY',
            price: '0.4',
            size: '12',
            orderType: 'GTC',
            meta: { side: 'down' },
          },
          {
            kind: 'place',
            cid: 'x1',
            outcome: 'UP',
            side: 'SELL',
            price: '0.7',
            size: '10',
            orderType: 'GTC',
          },
        ],
      },
      { tick: 1, intents: [{ kind: 'cancel', cid: 'x1' }] },
      {
        tick: 2,
        intents: [
          {
            kind: 'place',
            cid: 's1',
            outcome: 'UP',
            side: 'SELL',
            price: '0.45',
            size: '30',
            orderType: 'GTC',
          },
        ],
      },
      { tick: 3, intents: [{ kind: 'split', size: '5' }] },
      {
        tick: 5,
        intents: [
          {
            kind: 'place',
            cid: 'y1',
            outcome: 'UP',
            side: 'BUY',
            price: '0.3',
            size: '5',
            orderType: 'GTC',
            postOnly: true,
            meta: { late: true },
          },
        ],
      },
    ],
  },
  {
    name: 'latency',
    what: 'compat latency 50 ms: placements and a cancel release on the first real tick at or after execute_at, after its book update and before the maker scan',
    outcome: 'DOWN',
    latency: { delayMs: 50, jitterMs: 0 },
    rows: [
      book(S - 1_000, 'UP', ...UP_BOOK),
      book(S - 1_000, 'DOWN', ...DOWN_BOOK_LOW),
      pc(S + 100, ['UP', 'SELL', '0.47', '60']),
      pc(S + 120, ['UP', 'SELL', '0.47', '55']),
      pc(S + 160, ['DOWN', 'SELL', '0.49', '5']),
      pc(S + 200, ['DOWN', 'SELL', '0.48', '10']),
      pc(S + 300, ['DOWN', 'SELL', '0.47', '10']),
    ],
    script: [
      {
        tick: 0,
        intents: [
          {
            kind: 'place',
            cid: 'a1',
            outcome: 'UP',
            side: 'BUY',
            price: '0.47',
            size: '20',
            orderType: 'GTC',
            meta: { a: 1 },
          },
          {
            kind: 'place',
            cid: 'a2',
            outcome: 'DOWN',
            side: 'BUY',
            price: '0.5',
            size: '10',
            orderType: 'GTC',
            meta: { a: 2, note: 'rest' },
          },
        ],
      },
      { tick: 1, intents: [{ kind: 'cancel', cid: 'a2' }] },
    ],
  },
  {
    name: 'fok_losing_side',
    what: 'FOK BUY filled across fractional sizes, FOK BUY killed for lack of depth (no fill, meta excluded), partial taker SELL of the losing outcome: negative pnl, fee rounding',
    outcome: 'UP',
    latency: { delayMs: 0, jitterMs: 0 },
    rows: [
      book(S - 1_000, 'UP', ...UP_BOOK),
      book(S - 1_000, 'DOWN', ...DOWN_BOOK),
      pc(S + 500, ['DOWN', 'SELL', '0.54', '50']),
      pc(S + 700, ['UP', 'BUY', '0.45', '90']),
      pc(S + 900, ['DOWN', 'BUY', '0.52', '80']),
    ],
    script: [
      {
        tick: 0,
        intents: [
          {
            kind: 'place',
            cid: 'f1',
            outcome: 'DOWN',
            side: 'BUY',
            price: '0.55',
            size: '33.33',
            orderType: 'FOK',
            meta: { f: 1, w: 0.125 },
          },
          {
            kind: 'place',
            cid: 'f2',
            outcome: 'UP',
            side: 'BUY',
            price: '0.47',
            size: '100',
            orderType: 'FOK',
            meta: { f: 2 },
          },
        ],
      },
      {
        tick: 1,
        intents: [
          {
            kind: 'place',
            cid: 'q1',
            outcome: 'DOWN',
            side: 'SELL',
            price: '0.5',
            size: '10.01',
            orderType: 'GTC',
          },
        ],
      },
    ],
  },
  {
    name: 'zero_row_idle',
    what: 'in-window ticks, a post-only order placed and canceled, no fill and no position: zero row tagged no_in_window_activity',
    outcome: 'UP',
    latency: { delayMs: 0, jitterMs: 0 },
    rows: [
      book(S + 10, 'UP', ...UP_BOOK),
      book(S + 10, 'DOWN', ...DOWN_BOOK),
      pc(S + 20, ['UP', 'BUY', '0.46', '5']),
      pc(S + 30, ['UP', 'BUY', '0.46', '0']),
    ],
    script: [
      {
        tick: 0,
        intents: [
          {
            kind: 'place',
            cid: 'p1',
            outcome: 'UP',
            side: 'BUY',
            price: '0.3',
            size: '10',
            orderType: 'GTC',
            postOnly: true,
            meta: { z: 1 },
          },
        ],
      },
      { tick: 2, intents: [{ kind: 'cancel', cid: 'p1' }] },
    ],
  },
  {
    name: 'zero_row_out_of_window',
    what: 'counted ticks only before the window start: no strategy tick, zero row',
    outcome: 'DOWN',
    latency: { delayMs: 0, jitterMs: 0 },
    rows: [
      book(S - 5_000, 'UP', ...UP_BOOK),
      book(S - 5_000, 'DOWN', ...DOWN_BOOK),
      pc(S - 1, ['UP', 'BUY', '0.46', '5']),
    ],
    script: [
      {
        tick: 0,
        intents: [
          {
            kind: 'place',
            cid: 'never',
            outcome: 'UP',
            side: 'BUY',
            price: '0.5',
            size: '1',
            orderType: 'GTC',
          },
        ],
      },
    ],
  },
  {
    name: 'null_no_counted_tick',
    what: 'every row skipped by the reader (no exchange ts): no counted tick, marketStats null',
    outcome: 'UP',
    latency: { delayMs: 0, jitterMs: 0 },
    rows: [{ ts: null, type: 'book', asset: 'UP', bids: UP_BOOK[0], asks: UP_BOOK[1] }],
    script: [],
  },
]

/** Writes one case's rows with the converter's schema (asset0 = UP). */
async function writeParquet(file: string, rows: Row[]): Promise<void> {
  rmSync(file, { force: true })
  const w = await parquet.ParquetWriter.openFile(typedDeltaMarketEventParquetSchema, file)
  const idx = (o: Out): number => (o === 'UP' ? 0 : 1)
  let seq = 1n
  for (const r of rows) {
    const common = {
      ingest_seq: seq,
      ts_local_ms: BigInt((r.ts ?? S) + 7),
      ...(r.ts === null ? {} : { ts_exchange_ms: BigInt(r.ts) }),
      event_type: r.type,
      market: CONDITION,
      asset0_id: TOKENS.UP,
      asset1_id: TOKENS.DOWN,
    }
    seq += 1n
    if (r.type === 'book') {
      await w.appendRow({
        ...common,
        asset_index: idx(r.asset),
        bid_prices: r.bids.map((l) => l[0]),
        bid_sizes: r.bids.map((l) => l[1]),
        ask_prices: r.asks.map((l) => l[0]),
        ask_sizes: r.asks.map((l) => l[1]),
        change_asset_indexes: [],
        change_side_codes: [],
        change_prices: [],
        change_sizes: [],
      })
    } else {
      await w.appendRow({
        ...common,
        bid_prices: [],
        bid_sizes: [],
        ask_prices: [],
        ask_sizes: [],
        change_asset_indexes: r.changes.map((c) => idx(c.asset)),
        change_side_codes: r.changes.map((c) => (c.side === 'BUY' ? 0 : 1)),
        change_prices: r.changes.map((c) => c.price),
        change_sizes: r.changes.map((c) => c.size),
      })
    }
  }
  await w.close()
}

function scriptedDefinition(c: Case): StrategyDefinition<Record<string, never>> {
  const toIntent = (i: ScriptIntent): Intent => {
    switch (i.kind) {
      case 'place':
        return {
          kind: 'place_limit',
          clientOrderId: i.cid,
          assetId: TOKENS[i.outcome],
          side: i.side,
          price: Number(i.price),
          size: Number(i.size),
          orderType: i.orderType,
          ...(i.postOnly ? { postOnly: true } : {}),
          ...(i.meta ? { meta: { ...i.meta } } : {}),
        }
      case 'cancel':
        return { kind: 'cancel_order', clientOrderId: i.cid }
      case 'split':
        return {
          kind: 'split_positions',
          assetIdA: TOKENS.UP,
          assetIdB: TOKENS.DOWN,
          size: Number(i.size),
        }
    }
  }
  return {
    id: `stats-golden-${c.name}`,
    schema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    create: () => {
      let tick = 0
      const strategy: Strategy = {
        name: `stats-golden-${c.name}`,
        onMarketTick: () => {
          const step = c.script.find((s) => s.tick === tick)
          tick += 1
          return step ? step.intents.map(toIntent) : []
        },
        onAccountEvent: () => [],
      }
      return { strategy }
    },
  }
}

/** JSON with recursively sorted object keys (GF-2). */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    )
  }
  return v
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const results = []
  const log = console.log
  for (const c of cases) {
    const file = path.join(outDir, `${c.name}.parquet`)
    await writeParquet(file, c.rows)
    console.log = () => undefined
    let out
    try {
      out = await runSingleMarket({
        idx: 0,
        filePath: file,
        slug: SLUG,
        marketMeta: undefined,
        marketResolution: { tokenMap: { ...TOKENS }, outcome: c.outcome },
        strategyId: `stats-golden-${c.name}`,
        strategyParams: {},
        strategyDefinition: scriptedDefinition(c) as StrategyDefinition<unknown>,
        inputMode: 'telonex-delta',
        order: 'recorded',
        timeDriven: false,
        latency: c.latency,
        strategyWindow: WINDOW,
        machineId: 'golden',
        commitSha: 'golden',
        startingCapital: 500,
      })
    } finally {
      console.log = log
    }
    const stats = out.marketStats
      ? Object.fromEntries(Object.entries(out.marketStats).filter(([k]) => k !== 'execution'))
      : null
    results.push({
      name: c.name,
      what: c.what,
      parquet: path.relative(repoRoot, file),
      parquetSha256: sha256(readFileSync(file)),
      slug: SLUG,
      conditionId: CONDITION,
      tokens: TOKENS,
      outcome: c.outcome,
      startingCapital: '500',
      latency: c.latency,
      window: WINDOW,
      script: c.script,
      expected: {
        slug: out.slug,
        marketStats: stats,
        eventsProcessed: out.eventsProcessed,
        eventsByType: out.eventsByType,
        ...(out.skipReason ? { skipReason: out.skipReason } : {}),
      },
    })
  }

  const content = sortKeys({
    oracle: 'src/backtest/runSingleMarket.ts (BacktestExecution, Portfolio, computeMarketStats)',
    spec: 'native-spec-g1 21 §11-§16; 60 §7.1-§7.2',
    cases: results,
  })
  const goldenPath = path.join(outDir, 'stats_golden.json')
  const pin = execSync('git merge-base HEAD origin/main', { cwd: repoRoot }).toString().trim()
  let contentPin = pin
  if (existsSync(goldenPath)) {
    const prev = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      header?: { contentPin?: string }
      content?: unknown
    }
    if (JSON.stringify(prev.content) === JSON.stringify(content) && prev.header?.contentPin) {
      contentPin = prev.header.contentPin
    }
  }
  const header = {
    contentPin,
    generator: generatorRel,
    generatorSha256: sha256(readFileSync(path.join(repoRoot, generatorRel))),
  }
  // Formatted with the repo's Prettier config so `prettier . --check` (CI)
  // accepts the committed file as written.
  const text = JSON.stringify(sortKeys({ content, header }), null, 2) + '\n'
  const options = (await prettier.resolveConfig(goldenPath)) ?? {}
  writeFileSync(goldenPath, await prettier.format(text, { ...options, filepath: goldenPath }))
  console.log(results.map((r) => `${r.name}: ${JSON.stringify(r.expected)}`).join('\n'))
}

await main()
