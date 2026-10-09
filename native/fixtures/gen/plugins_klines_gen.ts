/**
 * Kline fixture generator for 14 §13 V-6 (a) and 60 §7.2 "TA candles vs
 * klines" (OHLC exact, volume relative 1e-9).
 *
 * For a fixed, deterministic sample of BTC 15m market starts `t0`, it requests
 * the Binance REST klines exactly as the TS oracle does
 * (`src/strategy/plugins/TechnicalIndicatorsPlugin.ts:235-251`: symbol
 * BTCUSDT, `endTime = t0 - 1`, 1h with limit 170 and 15m with limit 50; the
 * same `/api/v3/klines` request `src/trading/feeds/binanceKlines.ts` builds),
 * keeps the raw response decimals (TS parses them with `Number`, the
 * correctly rounded double Rust's `str::parse` gives), and writes
 * `native/fixtures/golden/plugins/ta_klines.json`. The network is used only
 * here, never by the engine (14 V-6 (a), D19).
 *
 * The Rust test `pmb-plugins/tests/ta_klines.rs` builds the same candles from
 * the local aggTrades day files (14 P-8) and compares them with these rows.
 *
 * Sampling does not depend on the local dataset inventory, so regeneration at
 * any pin gives the same content (60 GF-2): `SAMPLE_FROM_MS`..`SAMPLE_TO_MS`
 * lies inside the BTCUSDT day files present on the fleet (2025-11-29 to
 * 2026-09-18) with the 160 h TA lookback (14 P-12) inside that range. Klines
 * are stored once per open time (raw Binance decimal strings, so OHLC stays
 * exact); each sample names the open-time range TS received.
 *
 * Usage (repo root): npx tsx native/fixtures/gen/plugins_klines_gen.ts
 *   (`--check`: regenerate in memory and exit 1 on any difference, 60 GF-4)
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const GENERATOR = 'native/fixtures/gen/plugins_klines_gen.ts'
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const outDir = path.join(repoRoot, 'native/fixtures/golden/plugins')

const SYMBOL = 'BTCUSDT'
const H = 3_600_000
const Q = 900_000
const LIMIT_1H = 170 // TechnicalIndicatorsPlugin.ts LIMIT_1H = 160 + 10
const LIMIT_15M = 50 // LIMIT_15M = 40 + 10
const SAMPLE_FROM_MS = Date.UTC(2025, 11, 8) // first t0 with 160 h of local days
const SAMPLE_TO_MS = Date.UTC(2026, 8, 18) // exclusive
const RANDOM_SAMPLES = 52
// Fixed boundary cases: UTC midnight (the 160 h range starts inside a day),
// hour-aligned, and a quarter past (the current 1h candle is still open).
const FIXED_T0 = [
  Date.UTC(2025, 11, 8, 0, 0),
  Date.UTC(2026, 0, 1, 0, 0),
  Date.UTC(2026, 2, 29, 1, 0),
  Date.UTC(2026, 5, 15, 12, 15),
  Date.UTC(2026, 8, 17, 23, 45),
]

// ---------- deterministic PRNG (mulberry32) ----------
let state = 0x5eed_6a
function rnd(): number {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function sampleStarts(): number[] {
  const slots = (SAMPLE_TO_MS - SAMPLE_FROM_MS) / Q
  const set = new Set<number>(FIXED_T0)
  while (set.size < FIXED_T0.length + RANDOM_SAMPLES) {
    set.add(SAMPLE_FROM_MS + Math.floor(rnd() * slots) * Q)
  }
  return [...set].sort((a, b) => a - b)
}

// Raw kline row as Binance returns it: [openTime, open, high, low, close,
// volume, closeTime, quoteVolume, trades, takerBase, takerQuote, ignore].
type RawKline = [number, string, string, string, string, string, number, string, number]
// Stored row: [openTime, open, high, low, close, volume, closeTime, trades].
type Row = [number, string, string, string, string, string, number, number]

async function fetchKlines(interval: '1h' | '15m', endTime: number, limit: number) {
  const url = new URL('https://api.binance.com/api/v3/klines')
  url.searchParams.set('symbol', SYMBOL)
  url.searchParams.set('interval', interval)
  url.searchParams.set('endTime', String(endTime))
  url.searchParams.set('limit', String(limit))
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const raw = (await res.json()) as RawKline[]
      if (!Array.isArray(raw)) throw new Error('klines response is not an array')
      return raw.map((k): Row => [k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[8]])
    } catch (err) {
      if (attempt >= 4) throw err
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

// ---------- output (same rules as plugins_gen.ts, 60 GF-2) ----------
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

/** Pretty objects; arrays of primitives inline; other arrays one element per line. */
function render(v: unknown, indent = ''): string {
  const next = indent + '  '
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    if (v.every((x) => x === null || typeof x !== 'object')) return JSON.stringify(v)
    return '[\n' + v.map((x) => next + JSON.stringify(x)).join(',\n') + '\n' + indent + ']'
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

/**
 * `contentPin` is kept when the content is unchanged (60 GF-2); only new
 * content asks git for the oracle pin, so a checkout without `origin/main`
 * can still regenerate and diff (GF-4).
 */
function contentPinFor(target: string, bodyText: string): string {
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

function writeGolden(file: string, content: Record<string, unknown>): void {
  const target = path.join(outDir, file)
  const body = sortKeys(content) as Record<string, unknown>
  const generatorSha256 = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, GENERATOR)))
    .digest('hex')
  if (CHECK) return checkGolden(target, render(body), generatorSha256)
  const contentPin = contentPinFor(target, render(body))
  const out = sortKeys({ ...body, header: { contentPin, generator: GENERATOR, generatorSha256 } })
  writeFileSync(target, render(out) + '\n')
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const starts = sampleStarts()
  const h1 = new Map<number, Row>()
  const m15 = new Map<number, Row>()
  const samples: Array<Record<string, unknown>> = []
  const keep = (into: Map<number, Row>, rows: Row[], label: string) => {
    for (const r of rows) {
      const prev = into.get(r[0])
      if (prev && JSON.stringify(prev) !== JSON.stringify(r)) {
        throw new Error(`${label}: kline ${r[0]} differs between requests`)
      }
      into.set(r[0], r)
    }
  }
  for (const t0 of starts) {
    const asOf = t0 - 1
    const r1h = await fetchKlines('1h', asOf, LIMIT_1H)
    const r15m = await fetchKlines('15m', asOf, LIMIT_15M)
    if (r1h.length !== LIMIT_1H || r15m.length !== LIMIT_15M) {
      throw new Error(`t0=${t0}: short kline response ${r1h.length}/${r15m.length}`)
    }
    keep(h1, r1h, '1h')
    keep(m15, r15m, '15m')
    samples.push({
      t0,
      slug: `btc-updown-15m-${t0 / 1000}`,
      h1FirstOpen: r1h[0]![0],
      h1LastOpen: r1h[r1h.length - 1]![0],
      h1Count: r1h.length,
      m15FirstOpen: r15m[0]![0],
      m15LastOpen: r15m[r15m.length - 1]![0],
      m15Count: r15m.length,
    })
    process.stdout.write('.')
  }
  process.stdout.write('\n')
  const sorted = (m: Map<number, Row>) => [...m.values()].sort((a, b) => a[0] - b[0])
  writeGolden('ta_klines.json', {
    spec: 'native-spec-g1 14 §12.5 P-8, §13 V-6 (a); 60 §7.2 TA candles vs klines (OHLC exact, volume relative 1e-9)',
    symbol: SYMBOL,
    request: {
      endTime: 't0 - 1',
      limit1h: LIMIT_1H,
      limit15m: LIMIT_15M,
      intervalMs: { h1: H, m15: Q },
    },
    klineRow: '[openTime, open, high, low, close, volume, closeTime, trades]',
    samples,
    klines1h: sorted(h1),
    klines15m: sorted(m15),
  })
  console.log(`samples=${samples.length} klines1h=${h1.size} klines15m=${m15.size}`)
}

await main()
if (checkFailures > 0) process.exit(1)
