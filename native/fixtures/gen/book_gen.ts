/**
 * Golden generator for book semantics (60 §7.1 GF-1/GF-2, §7.2 "Book
 * semantics"; 15 §2.1 I-6a–I-6f). Feeds scripted and seeded-random market
 * messages through the real TS `MarketOrderBookEngine`
 * (`src/market/orderbook/*`) and records, after every message, the market
 * snapshot time, every listed asset's levels (full depth, best-first) and
 * timestamp, and the cumulative number of `delta_before_book` warnings.
 *
 * A `reset` step replaces the engine with a fresh `MarketOrderBookEngine`,
 * exactly what `MarketEngine.reset()` does on a V4 control gap
 * (`src/recorder-v4/replay/dispatcher.ts:179-189`).
 *
 * Messages carry decimal strings (TS parses them with `Number`, Rust with the
 * T6 parser); every value has at most 6 decimals, so the expected micros are
 * exact. Output: `native/fixtures/golden/book/book_golden.json`, sorted keys,
 * prettier-formatted, no timestamps, header {contentPin, generator, generatorSha256} where
 * `contentPin` is the oracle pin at which the content last changed (kept when
 * the regenerated content is identical, else `git merge-base HEAD origin/main`).
 *
 * Usage (repo root): npx tsx native/fixtures/gen/book_gen.ts [--check]
 *   --check  regenerate in memory and fail on any content difference
 *            (contentPin ignored, GF-4)
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as prettier from 'prettier'
import { MarketOrderBookEngine } from '../../../src/market/orderbook/index.js'
import type {
  AnyMarketMessage,
  MarketOrderBookWarning,
} from '../../../src/market/orderbook/index.js'

const GENERATOR = 'native/fixtures/gen/book_gen.ts'
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const target = path.join(repoRoot, 'native/fixtures/golden/book/book_golden.json')

const MARKET = '0xbookgoldenmarket'
const TOKEN: Record<Asset, string> = { UP: 'token-up', DOWN: 'token-down' }
const NAME: Record<string, Asset> = { 'token-up': 'UP', 'token-down': 'DOWN' }

type Asset = 'UP' | 'DOWN'
type Side = 'BUY' | 'SELL'
type Lvl = [string, string]
type Msg =
  | { type: 'book'; asset: Asset; ts: string; bids: Lvl[]; asks: Lvl[] }
  | { type: 'price_change'; ts: string; changes: [Asset, Side, string, string][] }
  | { type: 'last_trade_price'; asset: Asset; ts: string; price: string; size: string; side: Side }
  | { type: 'tick_size_change'; asset: Asset; ts: string; tick: string }
  | { type: 'reset' }

function toTs(m: Exclude<Msg, { type: 'reset' }>): AnyMarketMessage {
  switch (m.type) {
    case 'book':
      return {
        event_type: 'book',
        market: MARKET,
        asset_id: TOKEN[m.asset],
        bids: m.bids.map(([price, size]) => ({ price, size })),
        asks: m.asks.map(([price, size]) => ({ price, size })),
        timestamp: m.ts,
        hash: '',
      }
    case 'price_change':
      return {
        event_type: 'price_change',
        market: MARKET,
        price_changes: m.changes.map(([asset, side, price, size]) => ({
          asset_id: TOKEN[asset],
          side,
          price,
          size,
          hash: '',
          best_bid: '',
          best_ask: '',
        })),
        timestamp: m.ts,
      }
    case 'last_trade_price':
      return {
        event_type: 'last_trade_price',
        market: MARKET,
        asset_id: TOKEN[m.asset],
        price: m.price,
        size: m.size,
        side: m.side,
        fee_rate_bps: '0',
        timestamp: m.ts,
      }
    case 'tick_size_change':
      return {
        event_type: 'tick_size_change',
        market: MARKET,
        asset_id: TOKEN[m.asset],
        old_tick_size: '0.01',
        new_tick_size: m.tick,
        timestamp: m.ts,
      }
  }
}

const micros = (v: number): number => {
  const m = Math.round(v * 1e6)
  if (Math.abs(v * 1e6 - m) > 1e-6) throw new Error(`not exact at 1e-6: ${v}`)
  return m
}

/** Levels best-first as `priceMicros:sizeMicros` joined by `,`. */
const levels = (ls: readonly { price: number; size: number }[]): string =>
  ls.map((l) => `${micros(l.price)}:${micros(l.size)}`).join(',')

function run(messages: Msg[]) {
  let deltaBeforeBook = 0
  const validation = {
    enabled: true,
    onWarning: (w: MarketOrderBookWarning) => {
      if (w.kind === 'delta_before_book') deltaBeforeBook += 1
    },
  }
  let eng = new MarketOrderBookEngine({ validation })
  const steps = []
  for (const msg of messages) {
    if (msg.type === 'reset') eng = new MarketOrderBookEngine({ validation })
    else eng.applyAny(toTs(msg))
    const snap = eng.snapshot()
    const books: Record<string, unknown> = {}
    for (const [id, b] of Object.entries(snap.byAssetId)) {
      books[NAME[id]!] = {
        asks: levels(b.asks),
        bids: levels(b.bids),
        timestamp: b.timestamp,
      }
    }
    steps.push({ expect: { books, deltaBeforeBook, timestamp: snap.timestamp }, msg })
  }
  return steps
}

// ---------- scripted scenarios ----------
const scripted: { name: string; messages: Msg[] }[] = [
  {
    // I-6a: replace both sides; unsorted input; size <= 0 dropped before the
    // replace; duplicate prices (last positive wins); exponent decimals.
    name: 'book_replace',
    messages: [
      {
        type: 'book',
        asset: 'UP',
        ts: '1000',
        bids: [
          ['0.45', '10'],
          ['0.47', '5'],
          ['0.46', '0'],
          ['0.47', '0'],
          ['0.44', '-2'],
          ['0.43', '1'],
          ['0.43', '2.5'],
        ],
        asks: [
          ['0.55', '7'],
          ['5.1e-1', '3'],
          ['0.52', '0.000001'],
        ],
      },
      {
        type: 'book',
        asset: 'UP',
        ts: '1001',
        bids: [['0.40', '1']],
        asks: [],
      },
      {
        type: 'book',
        asset: 'DOWN',
        ts: '1002',
        bids: [],
        asks: [
          ['0.60', '4'],
          ['0.999', '1'],
          ['0.0001', '9'],
        ],
      },
      { type: 'book', asset: 'UP', ts: '1003', bids: [], asks: [] },
    ],
  },
  {
    // I-6b: set the aggregate size; size <= 0 deletes; deleting an absent
    // level; one message touching both assets, interleaved; the same level
    // set twice in one message (message order wins).
    name: 'delta_set',
    messages: [
      {
        type: 'book',
        asset: 'UP',
        ts: '2000',
        bids: [
          ['0.48', '10'],
          ['0.47', '20'],
        ],
        asks: [
          ['0.52', '10'],
          ['0.53', '20'],
        ],
      },
      {
        type: 'book',
        asset: 'DOWN',
        ts: '2000',
        bids: [['0.47', '10']],
        asks: [['0.53', '10']],
      },
      {
        type: 'price_change',
        ts: '2001',
        changes: [
          ['UP', 'BUY', '0.49', '5'],
          ['UP', 'BUY', '0.48', '11.5'],
          ['UP', 'SELL', '0.52', '0'],
          ['UP', 'SELL', '0.60', '0'],
        ],
      },
      {
        type: 'price_change',
        ts: '2002',
        changes: [
          ['DOWN', 'SELL', '0.51', '3'],
          ['UP', 'SELL', '0.51', '4'],
          ['DOWN', 'BUY', '0.47', '-1'],
          ['UP', 'BUY', '0.49', '6'],
          ['UP', 'BUY', '0.49', '0'],
          ['DOWN', 'SELL', '0.51', '8'],
        ],
      },
      {
        type: 'price_change',
        ts: '2003',
        changes: [
          ['UP', 'BUY', '0.001', '100'],
          ['UP', 'SELL', '0.999', '100'],
          ['UP', 'BUY', '1e-2', '1'],
        ],
      },
    ],
  },
  {
    // I-6c: a change, print or tick-size change for an asset without a book
    // creates an empty book; deltaBeforeBook counts per message and asset
    // until the asset's first book.
    name: 'delta_before_book',
    messages: [
      {
        type: 'price_change',
        ts: '3000',
        changes: [
          ['DOWN', 'BUY', '0.40', '1'],
          ['DOWN', 'SELL', '0.60', '1'],
        ],
      },
      { type: 'price_change', ts: '3001', changes: [['DOWN', 'BUY', '0.41', '2']] },
      { type: 'last_trade_price', asset: 'UP', ts: '3002', price: '0.5', size: '3', side: 'BUY' },
      { type: 'tick_size_change', asset: 'UP', ts: '3003', tick: '0.001' },
      {
        type: 'price_change',
        ts: '3004',
        changes: [
          ['UP', 'BUY', '0.45', '1'],
          ['DOWN', 'SELL', '0.60', '0'],
        ],
      },
      { type: 'book', asset: 'DOWN', ts: '3005', bids: [['0.30', '1']], asks: [] },
      {
        type: 'price_change',
        ts: '3006',
        changes: [
          ['DOWN', 'BUY', '0.31', '1'],
          ['UP', 'BUY', '0.46', '1'],
        ],
      },
      { type: 'book', asset: 'UP', ts: '3007', bids: [], asks: [['0.70', '1']] },
      { type: 'price_change', ts: '3008', changes: [['UP', 'SELL', '0.69', '1']] },
      {
        type: 'last_trade_price',
        asset: 'DOWN',
        ts: '3009',
        price: '0.3',
        size: '1',
        side: 'SELL',
      },
    ],
  },
  {
    // I-6d: every message sets the snapshot time to its timestamp (prints and
    // tick-size changes included); it can move backwards across assets.
    name: 'timestamp',
    messages: [
      { type: 'book', asset: 'UP', ts: '5000', bids: [['0.5', '1']], asks: [] },
      { type: 'book', asset: 'DOWN', ts: '4990', bids: [], asks: [['0.5', '1']] },
      { type: 'price_change', ts: '4980', changes: [['UP', 'BUY', '0.4', '1']] },
      { type: 'last_trade_price', asset: 'DOWN', ts: '5100', price: '0.5', size: '1', side: 'BUY' },
      { type: 'tick_size_change', asset: 'UP', ts: '4000', tick: '0.01' },
      { type: 'price_change', ts: '5200', changes: [['DOWN', 'SELL', '0.5', '0']] },
    ],
  },
  {
    // I-6f: a reset unlists every book and the snapshot time; later messages
    // rebuild books with I-6a–I-6c.
    name: 'reset',
    messages: [
      { type: 'book', asset: 'UP', ts: '6000', bids: [['0.4', '1']], asks: [['0.6', '1']] },
      { type: 'book', asset: 'DOWN', ts: '6001', bids: [['0.4', '1']], asks: [['0.6', '1']] },
      { type: 'reset' },
      { type: 'price_change', ts: '6002', changes: [['UP', 'BUY', '0.45', '2']] },
      { type: 'book', asset: 'DOWN', ts: '6003', bids: [], asks: [['0.55', '3']] },
      { type: 'reset' },
      { type: 'tick_size_change', asset: 'DOWN', ts: '6004', tick: '0.001' },
    ],
  },
]

// ---------- seeded random scenario (mulberry32) ----------
let state = 0
function seed(s: number): void {
  state = s >>> 0
}
function rnd(): number {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function rint(lo: number, hi: number): number {
  return lo + Math.floor(rnd() * (hi - lo + 1))
}
function pick<T>(xs: readonly T[]): T {
  return xs[rint(0, xs.length - 1)]!
}

const PRICES = [
  '0.01',
  '0.1',
  '0.25',
  '0.3',
  '0.333',
  '0.4',
  '0.45',
  '0.5',
  '0.55',
  '0.6',
  '0.7',
  '0.75',
  '0.9',
  '0.99',
  '0.999',
]
const SIZES = ['0', '0', '1', '2.5', '10', '100.123456', '5e1', '-1', '0.000001']

function randomMessages(n: number): Msg[] {
  seed(20261009)
  const out: Msg[] = []
  let ts = 10_000
  for (let i = 0; i < n; i += 1) {
    ts += rint(-3, 10)
    const r = rnd()
    const asset: Asset = rnd() < 0.5 ? 'UP' : 'DOWN'
    if (r < 0.15) {
      const side = () => Array.from({ length: rint(0, 6) }, (): Lvl => [pick(PRICES), pick(SIZES)])
      out.push({ type: 'book', asset, ts: String(ts), bids: side(), asks: side() })
    } else if (r < 0.88) {
      const changes = Array.from({ length: rint(1, 5) }, (): [Asset, Side, string, string] => [
        rnd() < 0.5 ? 'UP' : 'DOWN',
        rnd() < 0.5 ? 'BUY' : 'SELL',
        pick(PRICES),
        pick(SIZES),
      ])
      out.push({ type: 'price_change', ts: String(ts), changes })
    } else if (r < 0.93) {
      out.push({
        type: 'last_trade_price',
        asset,
        ts: String(ts),
        price: pick(PRICES),
        size: '1',
        side: 'BUY',
      })
    } else if (r < 0.98) {
      out.push({ type: 'tick_size_change', asset, ts: String(ts), tick: '0.001' })
    } else {
      out.push({ type: 'reset' })
    }
  }
  return out
}

const scenarios = [
  ...scripted.map((s) => ({ name: s.name, steps: run(s.messages) })),
  { name: 'random_seed_20261009', steps: run(randomMessages(300)) },
]

// ---------- deterministic output ----------
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

const body = sortKeys({
  format:
    'steps[i].msg is applied to the books of steps[i-1]; expect = TS snapshot after it: timestamp (0 = none), books by asset (levels best-first as priceMicros:sizeMicros joined by commas, asset timestamp), cumulative delta_before_book warnings',
  scenarios,
  spec: 'native-spec-g1 15 §2.1 I-6a..I-6f, §8 deltaBeforeBook; 60 §7.2 Book semantics',
}) as Record<string, unknown>
const bodyText = JSON.stringify(body)

let previous: string | null = null
let contentPin = execSync('git merge-base HEAD origin/main', { cwd: repoRoot }).toString().trim()
if (existsSync(target)) {
  const { header, ...prevBody } = JSON.parse(readFileSync(target, 'utf8')) as Record<
    string,
    unknown
  >
  previous = JSON.stringify(sortKeys(prevBody))
  if (previous === bodyText) contentPin = (header as { contentPin: string }).contentPin
}
if (process.argv.includes('--check')) {
  if (previous !== bodyText) {
    console.error(`${path.relative(repoRoot, target)}: content differs from the TS oracle`)
    process.exit(1)
  }
  console.log(`${path.relative(repoRoot, target)}: up to date`)
} else {
  const generatorSha256 = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, GENERATOR)))
    .digest('hex')
  const out = sortKeys({ ...body, header: { contentPin, generator: GENERATOR, generatorSha256 } })
  mkdirSync(path.dirname(target), { recursive: true })
  // Prettier-formatted, so `prettier . --check` (CI) accepts the golden.
  const options = (await prettier.resolveConfig(target)) ?? {}
  writeFileSync(
    target,
    await prettier.format(JSON.stringify(out), { ...options, filepath: target }),
  )
  const steps = scenarios.reduce((n, s) => n + s.steps.length, 0)
  console.log(`${path.relative(repoRoot, target)}: ${scenarios.length} scenarios, ${steps} steps`)
}
