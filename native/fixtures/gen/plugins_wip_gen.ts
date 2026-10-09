/**
 * The WIP plugin golden generator, carried verbatim (14 §13 V-5 "keep and
 * extend the WIP generator"; 14 §15 "keep the plugin math and
 * plugins_golden.json"; 60 §16 "move to native/fixtures/ (GF-1); add headers
 * (GF-2)"). Source: `native/crates/domain/tests/fixtures/plugins_gen.ts`
 * at fef5f199. Only the import paths and the output step changed: the
 * output is written to `native/fixtures/golden/plugins/plugins_wip_golden.json`
 * with sorted keys and the GF-2 header instead of printed to stdout. The
 * scenario logic, the LCG seed, the cent price grid and the sampling rule
 * are unchanged, so the content equals the WIP `plugins_golden.json`. The
 * V-5 extensions (sawtooth, missing sides, non-finite timestamps, long
 * synthetic runs) are new scenarios in `plugins_gen.ts`.
 *
 * Usage (repo root): npx tsx native/fixtures/gen/plugins_wip_gen.ts
 *   (`--check`: regenerate in memory and exit 1 on any difference, 60 GF-4)
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

const GENERATOR = 'native/fixtures/gen/plugins_wip_gen.ts'
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const target = path.join(repoRoot, 'native/fixtures/golden/plugins/plugins_wip_golden.json')

// ---------- output (GF-2: sorted keys, header; same layout as plugins_gen.ts) ----------
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

// `--check` (60 GF-4): regenerate in memory and fail on any content
// difference from the committed golden or a stale generatorSha256
// (contentPin is ignored); writes nothing. `native:goldens:check` runs this.
const CHECK = process.argv.includes('--check')
const extraArgs = process.argv.slice(2).filter((a) => a !== '--check')
if (extraArgs.length > 0) throw new Error(`unknown arguments: ${extraArgs.join(' ')}`)
let checkFailures = 0

/** In check mode: compare with the committed file instead of writing it. */
function checkGolden(target: string, bodyText: string, generatorSha256: string): void {
  const name = path.basename(target)
  if (!existsSync(target)) {
    console.error(`${name}: missing; regenerate`)
    checkFailures += 1
    return
  }
  const prev = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>
  const { header, ...prevBody } = prev
  if (render(sortKeys(prevBody)) !== bodyText) {
    console.error(`${name}: content differs from the TS oracle; regenerate`)
    checkFailures += 1
  } else if ((header as { generatorSha256?: string }).generatorSha256 !== generatorSha256) {
    console.error(`${name}: generatorSha256 is stale; regenerate`)
    checkFailures += 1
  } else {
    console.log(`${name}: up to date`)
  }
}

/** `contentPin` is kept when the content is unchanged; only new content asks git (GF-2, GF-4). */
function contentPinFor(bodyText: string): string {
  if (existsSync(target)) {
    const prev = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>
    const { header, ...prevBody } = prev
    if (render(sortKeys(prevBody)) === bodyText) {
      return (header as { contentPin: string }).contentPin
    }
  }
  try {
    return execSync('git merge-base HEAD origin/main', { cwd: repoRoot, stdio: 'pipe' })
      .toString()
      .trim()
  } catch {
    throw new Error(
      `${path.basename(target)}: content changed and no origin/main ref to pin it to; fetch origin/main and rerun`,
    )
  }
}

function writeGolden(content: Record<string, unknown>): void {
  const body = sortKeys(content) as Record<string, unknown>
  const generatorSha256 = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, GENERATOR)))
    .digest('hex')
  if (CHECK) return checkGolden(target, render(body), generatorSha256)
  mkdirSync(path.dirname(target), { recursive: true })
  const contentPin = contentPinFor(render(body))
  const out = sortKeys({ ...body, header: { contentPin, generator: GENERATOR, generatorSha256 } })
  writeFileSync(target, render(out) + '\n')
}

// ---------- WIP generator (fef5f199), unchanged ----------
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
  p.onMarketTick(
    { snapshot: { market: 'm1', timestamp: t0, byAssetId: {} } } as never,
    {
      market: { slug },
    } as never,
  )
  for (let i = 0; i < 200 && p.snapshot() === undefined; i += 1) {
    await new Promise((r) => setTimeout(r, 5))
  }
  console.log = origLog
  globalThis.fetch = realFetch
  return { slug, h1, m15, expected: p.snapshot() ?? null }
}

// ---------- end of the WIP logic ----------

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
  writeGolden({ upAsset: UP, downAsset: DOWN, scenarios, ta })
}

await main()
if (checkFailures > 0) process.exit(1)
