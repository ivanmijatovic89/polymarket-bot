/**
 * Golden generator for the plugin math (60 §7.1 GF-1/GF-2, §7.2 "Plugin math";
 * 14 §13 V-5 and V-6 (b)). Runs the real TS plugins
 * (`src/strategy/plugins/**`) and writes:
 *
 * - `native/fixtures/golden/plugins/plugins_golden.json`: tick sequences
 *   through a `PluginSet` holding TimeWindowVolatility, DwellGate and
 *   TimeWindowGate, with the TS snapshot after sampled ticks. Extended per
 *   V-5 with sawtooth timestamps (synthetic stamps above the next real
 *   tick's time), missing book sides, non-finite timestamps (dropped by the
 *   window gate as `runSingleMarket.ts:306-313` does, so plugins never see
 *   them) and long synthetic runs.
 * - `native/fixtures/golden/plugins/ta_golden.json`: TechnicalIndicators on
 *   candle sets served through a patched `fetch` (same candles the Rust side
 *   gets), including the unavailable cases.
 *
 * Prices in tick fixtures are integer micros (10 §2); TS sees `micros / 1e6`,
 * the same double Rust's `to_f64_lossy` gives. Output is deterministic: a
 * seeded PRNG, sorted keys, no timestamps. Header: generator, its sha256 and
 * `contentPin` (the oracle pin at which the content last changed: kept when
 * the regenerated content is identical, else `git merge-base HEAD origin/main`).
 *
 * Usage (repo root): npx tsx native/fixtures/gen/plugins_gen.ts
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PluginSet } from '../../../src/strategy/plugins/PluginSet.js'
import { TimeWindowVolatility } from '../../../src/strategy/plugins/TimeWindowVolatility.js'
import { DwellGatePlugin } from '../../../src/strategy/plugins/DwellGatePlugin.js'
import { TimeWindowGatePlugin } from '../../../src/strategy/plugins/TimeWindowGatePlugin.js'
import { TechnicalIndicatorsPlugin } from '../../../src/strategy/plugins/TechnicalIndicatorsPlugin.js'

const GENERATOR = 'native/fixtures/gen/plugins_gen.ts'
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const outDir = path.join(repoRoot, 'native/fixtures/golden/plugins')

const UP = 'UPTOKEN'
const DOWN = 'DOWNTOKEN'

// ---------- deterministic PRNG (mulberry32) ----------
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

// ---------- tick fixtures ----------
type Side = { bid: number | null; ask: number | null } // micros
type TickIn = {
  ts: number | null // null: non-finite (see `nonFinite`)
  nonFinite?: 'NaN' | 'Infinity' | '-Infinity'
  synthetic: boolean
  up: Side
  down: Side
}

function sides(upBid: number, spread: number, dropRoll: number, dropRate: number): [Side, Side] {
  const upAsk = Math.min(990_000, upBid + spread)
  const up: Side = { bid: upBid, ask: upAsk }
  const down: Side = { bid: 1_000_000 - upAsk, ask: 1_000_000 - upBid }
  if (dropRoll < dropRate) up.bid = null
  else if (dropRoll < 2 * dropRate) up.ask = null
  else if (dropRoll < 3 * dropRate) down.bid = null
  else if (dropRoll < 4 * dropRate) {
    up.bid = null
    up.ask = null
    down.bid = null
    down.ask = null
  }
  return [up, down]
}

/** Random walk on a cent grid, 20% synthetic ticks (V-5 base case). */
function genRandomWalk(n: number, startTs: number): TickIn[] {
  const out: TickIn[] = []
  let ts = startTs
  let bid = 500_000
  for (let i = 0; i < n; i += 1) {
    ts += rint(20, 1500)
    bid = Math.max(10_000, Math.min(970_000, bid + (rint(0, 4) - 2) * 10_000))
    const [up, down] = sides(bid, rint(1, 3) * 10_000, rnd(), 0.03)
    out.push({ ts, synthetic: i > 0 && rnd() < 0.2, up, down })
  }
  return out
}

/**
 * Feed-driven sequence on a 0.001 grid: real ticks at exchange time E,
 * synthetic runs (up to 80 long) stamped S = max(v, E(last real)) with feed
 * visibility v that can overshoot the next real E, so the next real tick
 * steps back (sawtooth, 14 §12.3, adr-binance-driven-ticks.md:67-73). Real
 * exchange times also step back occasionally.
 */
function genSawtooth(nReal: number, startTs: number): TickIn[] {
  const out: TickIn[] = []
  let e = startTs
  let bid = 480_000
  let book: [Side, Side] = sides(bid, 10_000, 1, 0)
  for (let r = 0; r < nReal; r += 1) {
    const back = rnd() < 0.05
    e = back ? e - rint(1, 40) : e + rint(5, 900)
    bid = Math.max(5_000, Math.min(980_000, bid + (rint(0, 6) - 3) * 1_000))
    book = sides(bid, rint(1, 30) * 1_000, rnd(), 0.06)
    out.push({ ts: e, synthetic: false, up: book[0], down: book[1] })
    const run = rnd() < 0.1 ? rint(30, 80) : rint(0, 4)
    let v = e + rint(-200, 100)
    for (let k = 0; k < run; k += 1) {
      v += rint(0, 120)
      out.push({ ts: Math.max(v, e), synthetic: true, up: book[0], down: book[1] })
    }
  }
  return out
}

/**
 * Hand-made boundaries for the gates and the volatility readiness rule. Book
 * changes happen on real ticks only (synthetic ticks carry the last real
 * book, 14 §8).
 */
function genThresholds(start: number): TickIn[] {
  const s = (bid: number | null): Side => ({ bid, ask: bid === null ? null : bid + 10_000 })
  const lo = 400_000
  const hi = 600_000
  const t = (
    e: number,
    synthetic: boolean,
    upBid: number | null,
    downBid: number | null,
  ): TickIn => ({
    ts: start + e,
    synthetic,
    up: s(upBid),
    down: s(downBid),
  })
  return [
    t(-1500, false, lo, hi), // before start, both at the band edges
    t(-500, false, lo, hi + 1), // down leaves the band by one micro
    t(-1, true, lo, hi + 1),
    t(0, false, lo, 500_000),
    t(999, true, lo, 500_000), // gate opens at elapsed 1000
    t(1000, true, lo, 500_000), // up: elapsed 2500 >= 1000
    t(860, false, lo, 500_000), // real tick steps back below the synthetic stamps
    t(1000, false, hi, 500_000), // down: exactly requiredMs after entering at 0
    t(1001, false, hi, 500_000),
    t(1360, false, hi, 500_000),
    t(1860, false, lo - 1, 500_000), // up leaves the band
    t(1861, true, lo - 1, 500_000),
    t(2861, false, lo, 500_000), // up re-enters
    t(3860, true, lo, 500_000), // 999 ms in range
    t(3861, true, lo, 500_000), // exactly requiredMs
    t(4999, true, lo, 500_000),
    t(5000, true, lo, 500_000), // gate closes after elapsed 5000
    t(5001, true, lo, 500_000),
    t(4990, false, lo, 500_000), // back inside the gate window
    t(9000, false, null, null), // all sides missing
    t(9001, false, lo, null),
    t(9500, true, lo, null),
    t(10_000, false, lo, null),
    t(10_000, false, lo, null), // identical real tick: new volatility sample
  ]
}

/** Synthetic ticks carry the last real tick's book (unchanged book, 14 §8). */
function withRealBooks(ticks: TickIn[]): TickIn[] {
  let last: TickIn | undefined
  return ticks.map((t) => {
    if (!t.synthetic) {
      if (t.ts !== null) last = t
      return t
    }
    if (!last) throw new Error('a synthetic tick needs a preceding real tick')
    return { ...t, up: { ...last.up }, down: { ...last.down } }
  })
}

/** Random walk with non-finite timestamps sprinkled in (gate-dropped). */
function genNonFinite(n: number, startTs: number): TickIn[] {
  const base = genRandomWalk(n, startTs)
  const kinds: Array<'NaN' | 'Infinity' | '-Infinity'> = ['NaN', 'Infinity', '-Infinity']
  return base.map((t, i) =>
    i > 0 && i % 9 === 4 ? { ...t, ts: null, nonFinite: kinds[i % 3]!, synthetic: false } : t,
  )
}

// ---------- TS harness ----------
type PluginsCfg = {
  timeWindowVolatility?: { windows: Record<string, number>; trackPrice: 'bid' | 'ask' | 'mid' }
  dwellGate?: {
    fromMicros: number
    toMicros: number
    requiredMs: number
    trackPrice: 'bid' | 'ask'
  }
  timeWindowGate?: { allowAfterMs: number; disableAfterMs: number }
}

function bookSnap(ts: number, assetId: string, s: Side) {
  const bestBid = s.bid === null ? null : s.bid / 1e6
  const bestAsk = s.ask === null ? null : s.ask / 1e6
  return {
    market: 'm1',
    assetId,
    timestamp: ts,
    bestBid,
    bestAsk,
    mid: bestBid === null || bestAsk === null ? null : (bestBid + bestAsk) / 2,
  }
}

function tsValue(t: TickIn): number {
  if (t.ts !== null) return t.ts
  return t.nonFinite === 'Infinity' ? Infinity : t.nonFinite === '-Infinity' ? -Infinity : NaN
}

function runScenario(
  name: string,
  cfg: PluginsCfg,
  ticks: TickIn[],
  marketStartMs: number,
  sample: (i: number, t: TickIn) => boolean,
) {
  const set = new PluginSet()
  if (cfg.timeWindowVolatility) set.register(new TimeWindowVolatility(cfg.timeWindowVolatility))
  if (cfg.dwellGate) {
    const d = cfg.dwellGate
    set.register(
      new DwellGatePlugin({
        from: d.fromMicros / 1e6,
        to: d.toMicros / 1e6,
        requiredMs: d.requiredMs,
        trackPrice: d.trackPrice,
      }),
    )
  }
  if (cfg.timeWindowGate) set.register(new TimeWindowGatePlugin(cfg.timeWindowGate))
  const ctx = {
    market: {
      slug: `btc-updown-15m-${marketStartMs / 1000}`,
      upAssetId: UP,
      downAssetId: DOWN,
      eventStartTime: new Date(marketStartMs).toISOString(),
    },
  }
  ticks = withRealBooks(ticks)
  const expected: Array<{ i: number; snapshot: unknown }> = []
  for (const [i, t] of ticks.entries()) {
    const ts = tsValue(t)
    // The TS window gate drops non-finite timestamps before the runner
    // (runSingleMarket.ts:306-313): plugins never observe them.
    if (!Number.isFinite(ts)) continue
    const tick = {
      source: { kind: 'live', attempt: 1 },
      msg: {
        event_type: t.synthetic
          ? i % 2 === 0
            ? 'binance_agg_trade'
            : 'chainlink_round'
          : 'price_change',
      },
      snapshot: {
        market: 'm1',
        timestamp: ts,
        byAssetId: { [UP]: bookSnap(ts, UP, t.up), [DOWN]: bookSnap(ts, DOWN, t.down) },
      },
    }
    set.onMarketTick(tick as never, ctx as never)
    if (sample(i, t) || i >= ticks.length - 3) {
      expected.push({ i, snapshot: JSON.parse(JSON.stringify(set.snapshot())) })
    }
  }
  return { name, marketStartMs, upAsset: UP, downAsset: DOWN, plugins: cfg, ticks, expected }
}

// ---------- TA ----------
type Row = [number, number, number, number, number, number, number]
const H = 3_600_000
const Q = 900_000

function genCandles(
  intervalMs: number,
  lastOpen: number,
  count: number,
  base: number,
  vol: number,
): Row[] {
  const rows: Row[] = []
  let px = base
  for (let i = count - 1; i >= 0; i -= 1) {
    const open = lastOpen - i * intervalMs
    const o = px
    const c = Math.round(o * (1 + (rnd() - 0.5) * vol) * 100) / 100
    const h = Math.round(Math.max(o, c) * (1 + rnd() * vol * 0.4) * 100) / 100
    const l = Math.round(Math.min(o, c) * (1 - rnd() * vol * 0.4) * 100) / 100
    rows.push([open, o, h, l, c, Math.round(rnd() * 2_000_000) / 1000, open + intervalMs - 1])
    px = c
  }
  return rows
}

async function taScenario(name: string, slug: string, h1: Row[], m15: Row[]) {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input))
    const src = url.searchParams.get('interval') === '1h' ? h1 : m15
    const end = Number(url.searchParams.get('endTime'))
    const limit = Number(url.searchParams.get('limit'))
    const rows = src.filter((r) => r[0] <= end).slice(-limit)
    return new Response(JSON.stringify(rows.map((r) => r.map(String))), { status: 200 })
  }) as typeof fetch
  const logs = [console.log, console.warn, console.error] as const
  console.log = console.warn = console.error = () => {}
  const p = new TechnicalIndicatorsPlugin()
  p.onMarketTick(
    { snapshot: { market: 'm1', timestamp: 0, byAssetId: {} } } as never,
    {
      market: { slug },
    } as never,
  )
  // The plugin finalizes asynchronously; wait until it settled either way.
  const internals = p as unknown as { inFlightKey: string | null }
  for (let i = 0; i < 400 && internals.inFlightKey !== null; i += 1) {
    await new Promise((r) => setTimeout(r, 5))
  }
  ;[console.log, console.warn, console.error] = logs
  globalThis.fetch = realFetch
  if (internals.inFlightKey !== null) throw new Error(`TA scenario ${name} did not settle`)
  return { name, slug, h1, m15, expected: p.snapshot() ?? null }
}

// ---------- output ----------
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

const hasArray = (x: unknown): boolean =>
  !!x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).some(Array.isArray)

/**
 * Pretty objects; arrays of primitives inline; other arrays one element per
 * line, compact unless the element itself holds arrays (scenarios).
 */
function render(v: unknown, indent = ''): string {
  const next = indent + '  '
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    if (v.every((x) => x === null || typeof x !== 'object')) return JSON.stringify(v)
    const items = v.map((x) => next + (hasArray(x) ? render(x, next) : JSON.stringify(x)))
    return '[\n' + items.join(',\n') + '\n' + indent + ']'
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return (
      '{\n' +
      entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${render(x, next)}`).join(',\n') +
      '\n' +
      indent +
      '}'
    )
  }
  return JSON.stringify(v)
}

function writeGolden(file: string, content: Record<string, unknown>): void {
  const target = path.join(outDir, file)
  const body = sortKeys(content) as Record<string, unknown>
  const bodyText = render(body)
  let contentPin = execSync('git merge-base HEAD origin/main', { cwd: repoRoot }).toString().trim()
  if (existsSync(target)) {
    const prev = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>
    const { header, ...prevBody } = prev
    if (render(sortKeys(prevBody)) === bodyText) {
      contentPin = (header as { contentPin: string }).contentPin
    }
  }
  const generatorSha256 = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, GENERATOR)))
    .digest('hex')
  const out = sortKeys({ ...body, header: { contentPin, generator: GENERATOR, generatorSha256 } })
  writeFileSync(target, render(out) + '\n')
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const start = 1_760_140_800_000

  seed(12345)
  const walk = genRandomWalk(300, start - 5_000)
  seed(777)
  const saw = genSawtooth(300, start - 4_000)
  seed(4242)
  const nonFinite = genNonFinite(120, start - 2_000)

  const every = (k: number) => (i: number, t: TickIn) => i % k === 0 || (t.synthetic && i % 3 === 0)
  const scenarios = [
    runScenario(
      'mid_vol_bid_dwell_gate',
      {
        timeWindowVolatility: {
          windows: { '1s': 1000, '5s': 5000, '30s': 30000 },
          trackPrice: 'mid',
        },
        dwellGate: { fromMicros: 600_000, toMicros: 400_000, requiredMs: 3000, trackPrice: 'bid' },
        timeWindowGate: { allowAfterMs: 10_000, disableAfterMs: 400_000 },
      },
      walk,
      start,
      every(6),
    ),
    runScenario(
      'bid_vol_ask_dwell',
      {
        timeWindowVolatility: { windows: { w2: 2000, w10: 10000 }, trackPrice: 'bid' },
        dwellGate: { fromMicros: 300_000, toMicros: 700_000, requiredMs: 1500, trackPrice: 'ask' },
      },
      walk,
      start,
      every(6),
    ),
    runScenario(
      'sawtooth_long_synthetic',
      {
        timeWindowVolatility: { windows: { '1s': 1000, '3000': 3000 }, trackPrice: 'ask' },
        dwellGate: { fromMicros: 450_000, toMicros: 550_000, requiredMs: 800, trackPrice: 'ask' },
        timeWindowGate: { allowAfterMs: 2_000, disableAfterMs: 60_000 },
      },
      saw,
      start,
      (i) => i % 10 === 0,
    ),
    runScenario(
      'gate_dwell_thresholds',
      {
        timeWindowVolatility: { windows: { '2s': 2000 }, trackPrice: 'mid' },
        dwellGate: { fromMicros: 400_000, toMicros: 600_000, requiredMs: 1000, trackPrice: 'bid' },
        timeWindowGate: { allowAfterMs: 1_000, disableAfterMs: 5_000 },
      },
      genThresholds(start),
      start,
      () => true,
    ),
    runScenario(
      'non_finite_ts',
      {
        timeWindowVolatility: { windows: { '5s': 5000 }, trackPrice: 'mid' },
        dwellGate: { fromMicros: 450_000, toMicros: 650_000, requiredMs: 2000, trackPrice: 'bid' },
        timeWindowGate: { allowAfterMs: 0, disableAfterMs: 30_000 },
      },
      nonFinite,
      start,
      every(4),
    ),
  ]
  writeGolden('plugins_golden.json', {
    spec: 'native-spec-g1 14 §12, §13 V-5; 60 §7.2 Plugin math (integers exact, floats relative 1e-9)',
    scenarios,
  })

  seed(99)
  const t0a = 1_760_140_800_000 // Sat 00:00 UTC, hour-aligned
  const t0b = t0a + Q // 00:15: the 1h candle at 00:00 is still open
  const t0c = t0a + 3 * 86_400_000 + 16 * H + 3 * Q // Tue 16:45 UTC, US session
  const ta = [
    await taScenario(
      'hour_aligned',
      'btc-updown-15m-1760140800',
      genCandles(H, t0a - H, 200, 60_000, 0.01),
      genCandles(Q, t0a - Q, 60, 61_000, 0.004),
    ),
    await taScenario(
      'quarter_past_open_hour',
      `btc-updown-15m-${t0b / 1000}`,
      genCandles(H, t0b - Q, 200, 95_000, 0.012),
      genCandles(Q, t0b - Q, 60, 95_500, 0.005),
    ),
    await taScenario(
      'us_session',
      `btc-updown-15m-${t0c / 1000}`,
      genCandles(H, t0c - 3 * Q, 175, 110_000, 0.008),
      genCandles(Q, t0c - Q, 45, 110_200, 0.003),
    ),
    await taScenario(
      'misaligned_15m',
      'btc-updown-15m-1760140800',
      genCandles(H, t0a - H, 200, 60_000, 0.01),
      genCandles(Q, t0a - 2 * Q, 60, 61_000, 0.004),
    ),
    await taScenario(
      'not_enough_1h',
      'btc-updown-15m-1760140800',
      genCandles(H, t0a - H, 120, 60_000, 0.01),
      genCandles(Q, t0a - Q, 60, 61_000, 0.004),
    ),
    await taScenario(
      'five_minute_slug',
      'btc-updown-5m-1760140800',
      genCandles(H, t0a - H, 200, 60_000, 0.01),
      genCandles(Q, t0a - Q, 60, 61_000, 0.004),
    ),
  ]
  writeGolden('ta_golden.json', {
    spec: 'native-spec-g1 14 §12.5, §13 V-6 (b); 60 §7.2 Plugin math (floats relative 1e-9)',
    candleRow: '[openTime, open, high, low, close, volume, closeTime]',
    scenarios: ta,
  })
  console.log(
    scenarios
      .map((s) => `${s.name}: ticks=${s.ticks.length} expected=${s.expected.length}`)
      .join('\n'),
  )
  console.log(ta.map((s) => `${s.name}: ${s.expected ? 'ready' : 'unavailable'}`).join('\n'))
}

await main()
