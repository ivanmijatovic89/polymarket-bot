// Golden fixture generator for the Rust plugin port (pmb-core/src/plugins).
// Runs the real TypeScript plugins on deterministic synthetic sequences.
// From the repo root:
//   npx tsx native/crates/pmb-core/tests/fixtures/plugins_gen.ts > native/crates/pmb-core/tests/fixtures/plugins_golden.json
import { PluginSet } from '../../../../../src/strategy/plugins/PluginSet.js'
import { TimeWindowVolatility } from '../../../../../src/strategy/plugins/TimeWindowVolatility.js'
import { DwellGatePlugin } from '../../../../../src/strategy/plugins/DwellGatePlugin.js'
import { TimeWindowGatePlugin } from '../../../../../src/strategy/plugins/TimeWindowGatePlugin.js'
import { TechnicalIndicatorsPlugin } from '../../../../../src/strategy/plugins/TechnicalIndicatorsPlugin.js'

const UP = 'UPTOKEN'
const DOWN = 'DOWNTOKEN'

let seed = 12345
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

type SideCents = { bid: number | null; ask: number | null }
type TickIn = { ts: number; synthetic: boolean; up: SideCents; down: SideCents }

function genTicks(n: number, startTs: number): TickIn[] {
  const out: TickIn[] = []
  let ts = startTs
  let upBid = 50
  for (let i = 0; i < n; i += 1) {
    ts += 20 + Math.floor(rnd() * 1500)
    upBid = Math.max(1, Math.min(97, upBid + Math.floor(rnd() * 5) - 2))
    const spread = 1 + Math.floor(rnd() * 3)
    const upAsk = Math.min(99, upBid + spread)
    const dBid = 100 - upAsk
    const dAsk = 100 - upBid
    const drop = rnd()
    const up: SideCents = { bid: drop < 0.05 ? null : upBid, ask: drop > 0.95 ? null : upAsk }
    const down: SideCents = { bid: drop < 0.08 && drop > 0.04 ? null : dBid, ask: dAsk }
    const synthetic = i > 0 && rnd() < 0.2
    out.push({ ts, synthetic, up, down })
  }
  return out
}

function bookSnap(ts: number, assetId: string, s: SideCents) {
  const bestBid = s.bid === null ? null : s.bid / 100
  const bestAsk = s.ask === null ? null : s.ask / 100
  return {
    market: 'm1',
    assetId,
    timestamp: ts,
    bestBid,
    bestAsk,
    mid: bestBid === null || bestAsk === null ? null : (bestBid + bestAsk) / 2,
  }
}

function runScenario(name: string, plugins: unknown[], ticks: TickIn[], marketStartMs: number) {
  const set = new PluginSet()
  for (const p of plugins) set.register(p as never)
  const ctx = {
    market: {
      slug: 'btc-updown-15m-' + marketStartMs / 1000,
      upAssetId: UP,
      downAssetId: DOWN,
      eventStartTime: new Date(marketStartMs).toISOString(),
    },
  }
  // Sampled to keep the fixture small: every 8th tick, half of the synthetic ticks, the tail.
  const expected: Array<{ i: number; snapshot: unknown }> = []
  let lastReal: TickIn | undefined
  for (const [i, t] of ticks.entries()) {
    // Synthetic ticks reuse the last real book (unchanged book, re-stamped time).
    const book = t.synthetic && lastReal ? lastReal : t
    if (!t.synthetic) lastReal = t
    const tick = {
      source: { kind: 'live', attempt: 1 },
      msg: { event_type: t.synthetic ? 'binance_agg_trade' : 'price_change' },
      snapshot: {
        market: 'm1',
        timestamp: t.ts,
        byAssetId: { [UP]: bookSnap(t.ts, UP, book.up), [DOWN]: bookSnap(t.ts, DOWN, book.down) },
      },
    }
    set.onMarketTick(tick as never, ctx as never)
    if (i % 8 === 0 || (t.synthetic && i % 2 === 0) || i >= ticks.length - 3) {
      expected.push({ i, snapshot: JSON.parse(JSON.stringify(set.snapshot())) })
    }
  }
  return { name, marketStartMs, ticks, expected }
}

// ---- TA: fake Binance klines through a patched global fetch ----
type Row = [number, number, number, number, number, number, number]
function genCandles(intervalMs: number, endOpen: number, count: number, base: number): Row[] {
  const rows: Row[] = []
  let px = base
  for (let i = count - 1; i >= 0; i -= 1) {
    const open = endOpen - i * intervalMs
    const o = px
    const c = Math.round(o * (1 + (rnd() - 0.5) * 0.01) * 100) / 100
    const h = Math.round(Math.max(o, c) * (1 + rnd() * 0.004) * 100) / 100
    const l = Math.round(Math.min(o, c) * (1 - rnd() * 0.004) * 100) / 100
    rows.push([open, o, h, l, c, Math.round(rnd() * 1000 * 1000) / 1000, open + intervalMs - 1])
    px = c
  }
  return rows
}

async function taScenario(slugEpochSec: number) {
  const t0 = slugEpochSec * 1000
  const h1 = genCandles(3_600_000, Math.floor((t0 - 1) / 3_600_000) * 3_600_000, 200, 60000)
  const m15 = genCandles(900_000, t0 - 900_000, 60, 61000)
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input))
    const interval = url.searchParams.get('interval')
    const end = Number(url.searchParams.get('endTime'))
    const limit = Number(url.searchParams.get('limit'))
    const src = interval === '1h' ? h1 : m15
    const rows = src.filter((r) => r[0] <= end).slice(-limit)
    return new Response(JSON.stringify(rows.map((r) => r.map(String))), { status: 200 })
  }) as typeof fetch
  const p = new TechnicalIndicatorsPlugin()
  const slug = `btc-updown-15m-${slugEpochSec}`
  const origLog = console.log
  console.log = () => {}
  p.onMarketTick({ snapshot: { market: 'm1', timestamp: t0, byAssetId: {} } } as never, {
    market: { slug },
  } as never)
  for (let i = 0; i < 200 && p.snapshot() === undefined; i += 1) {
    await new Promise((r) => setTimeout(r, 5))
  }
  console.log = origLog
  globalThis.fetch = realFetch
  return { slug, h1, m15, expected: p.snapshot() ?? null }
}

async function main() {
  const start = 1_760_140_800_000
  const ticks = genTicks(300, start - 5_000)
  const scenarios = [
    runScenario(
      'mid_vol_bid_dwell_gate',
      [
        new TimeWindowVolatility({ windows: { '1s': 1000, '5s': 5000, '30s': 30000 } }),
        new DwellGatePlugin({ from: 0.6, to: 0.4, requiredMs: 3000, trackPrice: 'bid' }),
        new TimeWindowGatePlugin({ allowAfterMs: 10_000, disableAfterMs: 400_000 }),
      ],
      ticks,
      start,
    ),
    runScenario(
      'bid_vol_ask_dwell',
      [
        new TimeWindowVolatility({ windows: { w2: 2000, w10: 10000 }, trackPrice: 'bid' }),
        new DwellGatePlugin({ from: 0.3, to: 0.7, requiredMs: 1500, trackPrice: 'ask' }),
      ],
      ticks,
      start,
    ),
  ]
  const ta = await taScenario(1_760_140_800)
  process.stdout.write(JSON.stringify({ upAsset: UP, downAsset: DOWN, scenarios, ta }) + '\n')
}

void main()
