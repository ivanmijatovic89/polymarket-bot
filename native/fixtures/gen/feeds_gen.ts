/**
 * Feed golden generator (60 §7.1 GF-1..GF-4; 14 §13 V-1 loader goldens and
 * V-2 timeline goldens). Runs the real TS oracle modules over the committed
 * input slices of native/fixtures/feeds/ (made by feeds_slice.ts) and writes
 * native/fixtures/golden/feeds/feeds_golden.json with sorted keys and the
 * header object {contentPin, generator, generatorSha256} (60 GF-2).
 *
 * Oracle modules: loadBinanceAggTradesSeries, loadChainlinkCryptoPricesSeries,
 * createBacktestExternalFeedsProvider, buildSyntheticTickSchedule,
 * createSyntheticFlusher, buildSyntheticFeedTick and feedClockMs. The tick
 * loop below mirrors runSingleMarket.ts:297-378 and :492 (counting before the
 * inclusive window gate, flush before every real tick, tail flush).
 *
 * Usage: npx tsx native/fixtures/gen/feeds_gen.ts [--out-dir <dir>] [--check]
 *   --out-dir <dir>  write <dir>/feeds/feeds_golden.json instead of the
 *                    committed golden and nothing else (the convention of
 *                    `npm run native:goldens:check`, 60 GF-4); the committed
 *                    golden is read only to keep its contentPin
 *   --check          local convenience: regenerate in memory and fail on any
 *                    content difference from the committed golden (the
 *                    header is ignored)
 *
 * contentPin (60 OR-1, GF-2) is the oracle pin at which the content last
 * changed: the committed pin when the content is unchanged, else the
 * origin/main commit last merged into this branch (git merge-base HEAD
 * origin/main).
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'
import type { MarketTick } from '../../../src/strategy/Strategy.js'
import type { ExternalFeedsSnapshot } from '../../../src/trading/feeds/externalFeeds.js'
import type { MarketOrderBooksSnapshot } from '../../../src/market/orderbook/index.js'
import {
  loadBinanceAggTradesSeries,
  type AsOfSeries,
} from '../../../src/backtest/feeds/binanceAggTradesSource.js'
import {
  loadChainlinkCryptoPricesSeries,
  type TwoClockAsOfSeries,
} from '../../../src/backtest/feeds/chainlinkCryptoPricesSource.js'
import { createBacktestExternalFeedsProvider } from '../../../src/backtest/feeds/backtestExternalFeedsProvider.js'
import {
  buildSyntheticTickSchedule,
  createSyntheticFlusher,
} from '../../../src/backtest/feeds/syntheticTickSchedule.js'
import { buildSyntheticFeedTick } from '../../../src/market/syntheticTick.js'
import { feedClockMs } from '../../../src/backtest/feeds/wireBacktestExternalFeeds.js'
import {
  BINANCE_LATENCY_MS,
  CHAINLINK_LATENCY_MS,
  FIXTURE_MARKETS,
  LOOKBACK_MS,
  PRICE_TO_BEAT_LATENCY_MS,
} from './feeds_markets.js'

const here = import.meta.dirname
const repoRoot = path.resolve(here, '../../..')
const feedsRoot = path.join(repoRoot, 'native/fixtures/feeds')
const goldenRel = 'feeds/feeds_golden.json'
const committedFile = path.join(repoRoot, 'native/fixtures/golden', goldenRel)
const outDirArg = process.argv.indexOf('--out-dir')
if (outDirArg >= 0 && !process.argv[outDirArg + 1]) throw new Error('--out-dir needs a directory')
const outFile =
  outDirArg >= 0 ? path.join(path.resolve(process.argv[outDirArg + 1]!), goldenRel) : committedFile
const generatorRel = 'native/fixtures/gen/feeds_gen.ts'
const SAMPLE_EVERY = 500

const hex = (v: number): string => {
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, v)
  return dv.getBigUint64(0).toString(16).padStart(16, '0')
}
const sha256 = (lines: string[]): string =>
  createHash('sha256')
    .update(lines.map((l) => l + '\n').join(''))
    .digest('hex')
const iso = (ms: number): string => new Date(ms).toISOString()

function useRoot(root: string): void {
  process.env.BINANCE_DATA_BASE_DIR = path.join(root, 'binance')
  process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = path.join(root, 'telonex/crypto_prices')
}

/** TS loader messages → 14 §10 class and cause (TS has no classes). */
function classify(message: string): { class: string; cause: string } {
  const rules: [RegExp, string, string][] = [
    [/missing Binance aggTrades day file/, 'data_missing', 'day_file_missing'],
    [/contain no trades/, 'data_defect', 'corrupt'],
    [/before crypto_prices coverage/, 'data_defect', 'pre_coverage'],
    [
      /missing Telonex crypto_prices day file|not available yet/,
      'data_missing',
      'day_file_missing',
    ],
    [/contain no rounds/, 'data_defect', 'corrupt'],
    [/NULL\/invalid server_timestamp_us/, 'data_defect', 'corrupt'],
    [/MISSING chainlink data/, 'data_defect', 'upstream_hole'],
  ]
  for (const [re, cls, cause] of rules) if (re.test(message)) return { class: cls, cause }
  throw new Error(`unclassified TS feed error: ${message}`)
}

const binanceLines = (s: AsOfSeries): string[] =>
  Array.from({ length: s.length }, (_, i) => `${s.tsMs[i]}|${hex(s.value[i]!)}`)
const chainlinkLines = (s: TwoClockAsOfSeries): string[] =>
  Array.from({ length: s.length }, (_, i) => `${s.tsMs[i]}|${s.visibleAtMs[i]}|${hex(s.value[i]!)}`)

function summarize(lines: string[], full: boolean): Record<string, unknown> {
  return full
    ? { len: lines.length, lines, sha256: sha256(lines) }
    : {
        head: lines.slice(0, 5),
        len: lines.length,
        sha256: sha256(lines),
        tail: lines.slice(-5),
      }
}

type LoaderCase = {
  name: string
  root: string
  feed: 'binance' | 'chainlink'
  slug: string
  maxGapMs?: number
  full: boolean
}

async function runLoader(c: LoaderCase): Promise<Record<string, unknown>> {
  useRoot(path.join(feedsRoot, c.root))
  const startMs = Number(c.slug.split('-').pop()) * 1000
  const endMs = startMs + 900_000
  const from = startMs - LOOKBACK_MS
  const base = {
    feed: c.feed,
    maxGapMs: c.maxGapMs ?? null,
    name: c.name,
    root: c.root,
    slug: c.slug,
  }
  if (c.maxGapMs === undefined) delete process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS
  else process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS = String(c.maxGapMs)
  try {
    if (c.feed === 'binance') {
      const s = await loadBinanceAggTradesSeries({
        pair: 'BTCUSDT',
        startMs,
        endMs,
        lookbackMs: LOOKBACK_MS,
      })
      const seeded = s.length > 0 && s.tsMs[0]! < from
      return { ...base, ok: { seeded, ...summarize(binanceLines(s), c.full) } }
    }
    const s = await loadChainlinkCryptoPricesSeries({
      assetId: 'btcusd',
      startMs,
      endMs,
      lookbackMs: LOOKBACK_MS,
    })
    const seeded = s.length > 0 && s.tsMs[0]! < from
    return { ...base, ok: { seeded, ...summarize(chainlinkLines(s), c.full) } }
  } catch (e) {
    return { ...base, error: classify((e as Error).message) }
  } finally {
    delete process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS
  }
}

const CRAFTED_SLUG = 'btc-updown-15m-1789560000' // 2026-09-16T12:00Z
const MISSING_SLUG = 'btc-updown-15m-1789646400' // 2026-09-17T12:00Z, no slice
const MIDNIGHT_SLUG = 'btc-updown-15m-1789603200' // 2026-09-17T00:00Z, two crafted days
const LOADER_CASES: LoaderCase[] = [
  ...FIXTURE_MARKETS.flatMap((m): LoaderCase[] => [
    { name: `${m.slug}/binance`, root: '.', feed: 'binance', slug: m.slug, full: false },
    { name: `${m.slug}/chainlink`, root: '.', feed: 'chainlink', slug: m.slug, full: false },
  ]),
  {
    name: 'binance-nonmono',
    root: 'crafted/binance-nonmono',
    feed: 'binance',
    slug: CRAFTED_SLUG,
    full: true,
  },
  {
    name: 'binance-empty',
    root: 'crafted/binance-empty',
    feed: 'binance',
    slug: CRAFTED_SLUG,
    full: true,
  },
  { name: 'binance-missing', root: '.', feed: 'binance', slug: MISSING_SLUG, full: true },
  {
    name: 'chainlink-twoclock',
    root: 'crafted/chainlink-twoclock',
    feed: 'chainlink',
    slug: CRAFTED_SLUG,
    full: true,
  },
  {
    name: 'chainlink-hole',
    root: 'crafted/chainlink-hole',
    feed: 'chainlink',
    slug: CRAFTED_SLUG,
    full: true,
  },
  {
    name: 'chainlink-hole-accepted',
    root: 'crafted/chainlink-hole',
    feed: 'chainlink',
    slug: CRAFTED_SLUG,
    maxGapMs: 0,
    full: true,
  },
  {
    name: 'chainlink-nullbc',
    root: 'crafted/chainlink-nullbc',
    feed: 'chainlink',
    slug: CRAFTED_SLUG,
    full: true,
  },
  { name: 'chainlink-missing', root: '.', feed: 'chainlink', slug: MISSING_SLUG, full: true },
  {
    name: 'chainlink-nullround',
    root: 'crafted/chainlink-nullround',
    feed: 'chainlink',
    slug: CRAFTED_SLUG,
    full: true,
  },
  {
    name: 'chainlink-twoday',
    root: 'crafted/chainlink-twoday',
    feed: 'chainlink',
    slug: MIDNIGHT_SLUG,
    full: true,
  },
  // GF-5 divergences: TS loads these; the Rust test asserts the spec value
  // (data_defect corrupt) under an expected_divergence annotation.
  ...[
    'binance-nullts',
    'binance-nullprice',
    'binance-zeroprice',
    'binance-negprice',
    'binance-dupid',
    'chainlink-seed-nullbc',
    'chainlink-zeroprice',
    'chainlink-foreign-asset',
  ].map(
    (name): LoaderCase => ({
      name,
      root: `crafted/${name}`,
      feed: name.startsWith('binance') ? 'binance' : 'chainlink',
      slug: CRAFTED_SLUG,
      full: true,
    }),
  ),
]

/** A real tick of the clock sequence: [E, L | null, 0 book | 1 price_change]. */
type ClockTick = [number, number | null, 0 | 1]

type TimelineInput = {
  window: { startMs: number; endMs: number }
  binance?: { series: AsOfSeries; latencyMs: number; tickOnUpdate: boolean }
  chainlink?: { series: TwoClockAsOfSeries; latencyMs: number; tickOnUpdate: boolean }
  priceToBeat?: { openPrice: number; latencyMs: number }
  ticks: ClockTick[]
}

function render(type: string, ts: number, snap: ExternalFeedsSnapshot): string {
  const b = snap.binanceWsSpotPrice
  const c = snap.rtdsPolymarketCryptoPrices?.chainlink
  const p = snap.polymarketPriceToBeat
  if (b && b.symbol !== 'btcusdt') throw new Error(`binance symbol ${b.symbol}`)
  if (c && c.symbol !== 'btc/usd') throw new Error(`chainlink symbol ${c.symbol}`)
  if (p && p.symbol !== 'BTC') throw new Error(`ptb symbol ${p.symbol}`)
  const bn = b ? `${b.tsMs},${hex(b.value)},${b.receivedAtMs}` : '-'
  const cl = c ? `${c.tsMs},${hex(c.value)},${c.receivedAtMs}` : '-'
  const ptb = p
    ? `${hex(p.openPrice)},${p.receivedAtMs},${p.eventStartTimeIso},${p.endDateIso}`
    : '-'
  return `${type}|${ts}|bn=${bn};cl=${cl};ptb=${ptb}`
}

/** Drives the oracle exactly as runSingleMarket.ts does for telonex-delta. */
async function runTimeline(t: TimelineInput): Promise<{
  lines: string[]
  counts: Record<string, number>
  snapshots: (ExternalFeedsSnapshot | null)[]
}> {
  const { startMs, endMs } = t.window
  const provider = createBacktestExternalFeedsProvider({
    ...(t.binance
      ? {
          binanceWsSpotPrice: {
            symbol: 'btcusdt',
            series: t.binance.series,
            latencyOffsetMs: t.binance.latencyMs,
          },
        }
      : {}),
    ...(t.chainlink
      ? {
          rtdsChainlink: {
            symbol: 'btc/usd',
            series: t.chainlink.series,
            latencyOffsetMs: t.chainlink.latencyMs,
          },
        }
      : {}),
    ...(t.priceToBeat
      ? {
          polymarketPriceToBeat: {
            symbol: 'BTC',
            eventStartTimeIso: iso(startMs),
            endDateIso: iso(endMs),
            openPrice: t.priceToBeat.openPrice,
            availableAtMs: startMs + t.priceToBeat.latencyMs,
          },
        }
      : {}),
  })
  const wantB = t.binance?.tickOnUpdate === true
  const wantC = t.chainlink?.tickOnUpdate === true
  const schedule =
    wantB || wantC
      ? buildSyntheticTickSchedule({
          ...(wantB
            ? {
                binance: {
                  series: t.binance!.series,
                  latencyOffsetMs: t.binance!.latencyMs,
                  symbol: 'btcusdt',
                },
              }
            : {}),
          ...(wantC
            ? {
                chainlink: {
                  series: t.chainlink!.series,
                  latencyOffsetMs: t.chainlink!.latencyMs,
                  symbol: 'btc/usd',
                },
              }
            : {}),
          windowStartMs: startMs,
          windowEndMs: endMs,
        })
      : null
  const lines: string[] = []
  const snapshots: (ExternalFeedsSnapshot | null)[] = []
  const counts: Record<string, number> = {}
  const dispatchTick = (tick: MarketTick): void => {
    const type = tick.msg.event_type
    counts[type] = (counts[type] ?? 0) + 1
    const ts = tick.snapshot.timestamp
    if (!Number.isFinite(ts) || ts < startMs || ts > endMs) {
      lines.push(`${type}|${ts}|gated`)
      snapshots.push(null)
      return
    }
    // The full TS snapshot shape (14 §11.2) next to the line rendering.
    const snap = provider.snapshotAt(feedClockMs(tick))
    lines.push(render(type, ts, snap))
    snapshots.push(snap)
  }
  let lastRealSnap: MarketOrderBooksSnapshot | undefined
  const flusher = createSyntheticFlusher({
    schedule,
    hasBaseSnapshot: () => lastRealSnap !== undefined,
    dispatch: async (ev) =>
      dispatchTick(
        buildSyntheticFeedTick({
          eventType: ev.eventType,
          symbol: ev.symbol,
          visibilityMs: ev.visibilityMs,
          baseSnapshot: lastRealSnap!,
          source: {
            kind: 'parquet',
            filePath: 'fixture',
            ingestSeq: 0n,
            tsLocalMs: ev.visibilityMs,
          },
        }) as unknown as MarketTick,
      ),
  })
  for (const [e, l, kind] of t.ticks) {
    const snapshot = {
      market: 'm',
      timestamp: e,
      byAssetId: {},
    } as unknown as MarketOrderBooksSnapshot
    const tick = {
      source: {
        kind: 'parquet',
        filePath: 'fixture',
        ingestSeq: 0n,
        ...(l !== null ? { tsLocalMs: l } : {}),
      },
      msg: { event_type: kind === 0 ? 'book' : 'price_change' },
      snapshot,
    } as unknown as MarketTick
    await flusher.flushUpTo(feedClockMs(tick))
    lastRealSnap = snapshot
    dispatchTick(tick)
  }
  await flusher.flushTail()
  return { lines, counts, snapshots }
}

function readClocks(slug: string): ClockTick[] {
  const j = JSON.parse(readFileSync(path.join(feedsRoot, 'clocks', `${slug}.json`), 'utf8')) as {
    e0: number
    ticks: [number, number | null, 0 | 1][]
  }
  let e = j.e0
  return j.ticks.map(([de, dl, k]) => {
    e += de
    return [e, dl === null ? null : e + dl, k]
  })
}

function timelineSummary(
  lines: string[],
  snapshots: (ExternalFeedsSnapshot | null)[],
): Record<string, unknown> {
  const samples: Record<string, string> = {}
  const snaps: Record<string, ExternalFeedsSnapshot | null> = {}
  for (let i = 0; i < lines.length; i += SAMPLE_EVERY) {
    samples[String(i)] = lines[i]!
    snaps[String(i)] = snapshots[i]!
  }
  const last = lines.length - 1
  snaps[String(last)] = snapshots[last]!
  return {
    delivered: lines.filter((l) => !l.endsWith('|gated')).length,
    head: lines.slice(0, 20),
    len: lines.length,
    samples,
    sha256: sha256(lines),
    snapshots: snaps,
    tail: lines.slice(-5),
  }
}

type Flags = { name: string; binance: boolean; chainlink: boolean; tickB: boolean; tickC: boolean }

async function realTimelines(): Promise<Record<string, unknown>[]> {
  useRoot(feedsRoot)
  const out: Record<string, unknown>[] = []
  for (const m of FIXTURE_MARKETS) {
    const window = { startMs: m.startMs, endMs: m.endMs }
    const b = await loadBinanceAggTradesSeries({
      pair: 'BTCUSDT',
      ...window,
      lookbackMs: LOOKBACK_MS,
    })
    const c = m.chainlink
      ? await loadChainlinkCryptoPricesSeries({
          assetId: 'btcusd',
          ...window,
          lookbackMs: LOOKBACK_MS,
        })
      : undefined
    const ticks = readClocks(m.slug)
    const configs: Flags[] = m.chainlink
      ? [
          { name: 'off', binance: true, chainlink: true, tickB: false, tickC: false },
          { name: 'binance-ticks', binance: true, chainlink: true, tickB: true, tickC: false },
          { name: 'all-ticks', binance: true, chainlink: true, tickB: true, tickC: true },
          {
            name: 'chainlink-only-ticks',
            binance: false,
            chainlink: true,
            tickB: false,
            tickC: true,
          },
        ]
      : [
          { name: 'off', binance: true, chainlink: false, tickB: false, tickC: false },
          { name: 'binance-ticks', binance: true, chainlink: false, tickB: true, tickC: false },
        ]
    for (const f of configs) {
      const r = await runTimeline({
        window,
        ...(f.binance
          ? { binance: { series: b, latencyMs: BINANCE_LATENCY_MS, tickOnUpdate: f.tickB } }
          : {}),
        ...(f.chainlink && c
          ? { chainlink: { series: c, latencyMs: CHAINLINK_LATENCY_MS, tickOnUpdate: f.tickC } }
          : {}),
        priceToBeat: { openPrice: m.priceToBeat, latencyMs: PRICE_TO_BEAT_LATENCY_MS },
        ticks,
      })
      out.push({
        config: f,
        counts: r.counts,
        name: `${m.slug}/${f.name}`,
        priceToBeat: m.priceToBeat,
        slug: m.slug,
        ...timelineSummary(r.lines, r.snapshots),
      })
    }
  }
  return out
}

/** Crafted V-2 sequences; inputs are embedded in the golden. */
type CraftedTimeline = {
  name: string
  window: { startMs: number; endMs: number }
  binance: { tsMs: number[]; value: number[]; latencyMs: number; tickOnUpdate: boolean }
  chainlink: {
    tsMs: number[]
    visibleAtMs: number[]
    value: number[]
    latencyMs: number
    tickOnUpdate: boolean
  }
  priceToBeat: { openPrice: number; latencyMs: number }
  ticks: ClockTick[]
}

const CRAFTED_TIMELINES: CraftedTimeline[] = [
  {
    // Backward local clocks, local behind exchange, missing local time, equal
    // timestamps (real tick first), out-of-window ticks on both sides, a
    // backward trade time in id order, and the tail flush.
    name: 'edges',
    window: { startMs: 10_000, endMs: 20_000 },
    binance: {
      tsMs: [8_000, 9_990, 10_000, 10_000, 10_500, 10_400, 15_000, 19_990, 20_500],
      value: [1, 1.5, 2, 2.25, 3, 2.75, 4, 5, 6],
      latencyMs: 10,
      tickOnUpdate: true,
    },
    chainlink: {
      tsMs: [9_000, 11_000, 10_800, 19_000],
      visibleAtMs: [9_800, 11_500, 11_600, 19_995],
      value: [100.5, 101.5, 101.25, 102],
      latencyMs: 5,
      tickOnUpdate: true,
    },
    priceToBeat: { openPrice: 100.125, latencyMs: 300 },
    ticks: [
      [9_000, 9_010, 0],
      [9_500, null, 1],
      [10_000, 10_008, 1],
      [10_010, 10_010, 1],
      [10_020, 10_005, 1], // local behind exchange: clamp to E
      [10_300, 10_310, 0],
      [10_310, 10_305, 1], // local steps back
      [10_510, 10_515, 1], // equals a schedule time (10 500 + 10): real first
      [11_505, 0, 1], // L = 0 means no local time
      [11_605, 11_604, 1],
      [12_000, 11_990, 1],
      [19_999, 20_001, 1],
      [20_000, 20_000, 1], // inclusive window end
      [20_001, 20_002, 1], // after the window: gated
      [20_400, 20_405, 0],
    ],
  },
  {
    // The first book arrives after several schedule entries: they are
    // consumed without dispatch and not counted (14 F-40, §8.4).
    name: 'late-first-book',
    window: { startMs: 10_000, endMs: 20_000 },
    binance: {
      tsMs: [9_000, 10_000, 10_100, 10_200, 10_600, 12_000],
      value: [1, 2, 3, 4, 5, 6],
      latencyMs: 0,
      tickOnUpdate: true,
    },
    chainlink: {
      tsMs: [9_500, 10_050],
      visibleAtMs: [9_900, 10_300],
      value: [50, 51],
      latencyMs: 0,
      tickOnUpdate: false,
    },
    priceToBeat: { openPrice: 7.5, latencyMs: 0 },
    ticks: [
      [10_250, 10_260, 0],
      [10_600, 10_590, 1],
      [10_700, null, 1],
    ],
  },
]

async function craftedTimelines(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (const c of CRAFTED_TIMELINES) {
    const b: AsOfSeries = {
      tsMs: Float64Array.from(c.binance.tsMs),
      value: Float64Array.from(c.binance.value),
      length: c.binance.tsMs.length,
    }
    const cl: TwoClockAsOfSeries = {
      tsMs: Float64Array.from(c.chainlink.tsMs),
      visibleAtMs: Float64Array.from(c.chainlink.visibleAtMs),
      value: Float64Array.from(c.chainlink.value),
      length: c.chainlink.tsMs.length,
    }
    const r = await runTimeline({
      window: c.window,
      binance: { series: b, latencyMs: c.binance.latencyMs, tickOnUpdate: c.binance.tickOnUpdate },
      chainlink: {
        series: cl,
        latencyMs: c.chainlink.latencyMs,
        tickOnUpdate: c.chainlink.tickOnUpdate,
      },
      priceToBeat: c.priceToBeat,
      ticks: c.ticks,
    })
    out.push({
      counts: r.counts,
      input: c,
      lines: r.lines,
      name: c.name,
      snapshots: r.snapshots,
    })
  }
  return out
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canon(o[k])]),
    )
  }
  return v
}

const loaders = []
for (const c of LOADER_CASES) loaders.push(await runLoader(c))
const content = canon({
  constants: {
    binanceLatencyMs: BINANCE_LATENCY_MS,
    chainlinkLatencyMs: CHAINLINK_LATENCY_MS,
    lookbackMs: LOOKBACK_MS,
    priceToBeatLatencyMs: PRICE_TO_BEAT_LATENCY_MS,
  },
  lineFormats: {
    binance: 'tsMs|f64 bits of value (hex)',
    chainlink: 'roundTsMs|broadcastMs|f64 bits of value (hex)',
    snapshots:
      'the TS ExternalFeedsSnapshot (14 §11.2) per delivered line, null when gated; real timelines keep the sample lines and the last line',
    timeline:
      'eventType|tick ts|gated, or bn=tsMs,bits,receivedAtMs;cl=tsMs,bits,receivedAtMs;ptb=bits,receivedAtMs,eventStartTimeIso,endDateIso ("-" = key absent)',
  },
  loaders,
  spec: 'native-spec-g1 14 §3-§6, §8.2, §10, §11.2, §13 V-1, V-2; 60 §7.1-§7.2',
  timelines: [...(await realTimelines()), ...(await craftedTimelines())],
}) as Record<string, unknown>

const contentText = JSON.stringify(content)
let previous: string | null = null
let committedPin: string | null = null
if (existsSync(committedFile)) {
  const old = JSON.parse(readFileSync(committedFile, 'utf8')) as Record<string, unknown>
  const { header, ...rest } = old
  previous = JSON.stringify(canon(rest))
  const pin = (header as { contentPin?: unknown } | undefined)?.contentPin
  if (typeof pin === 'string') committedPin = pin
}
if (process.argv.includes('--check')) {
  if (previous !== contentText) {
    console.error(`feeds golden differs from ${path.relative(repoRoot, committedFile)}`)
    process.exit(1)
  }
  console.log('feeds golden unchanged')
} else {
  const contentPin =
    previous === contentText && committedPin !== null
      ? committedPin
      : execSync('git merge-base HEAD origin/main', { cwd: repoRoot }).toString().trim()
  const generatorSha256 = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, generatorRel)))
    .digest('hex')
  const doc = {
    ...content,
    header: { contentPin, generator: generatorRel, generatorSha256 },
  }
  mkdirSync(path.dirname(outFile), { recursive: true })
  // Prettier-formatted with the repo config of the committed path, so the
  // output is identical with or without --out-dir and passes
  // `npm run code:prettier:check` (CI).
  const options = { ...(await resolveConfig(committedFile)), parser: 'json' }
  writeFileSync(outFile, await format(JSON.stringify(canon(doc)), options))
  console.log(`wrote ${outFile}`)
}
