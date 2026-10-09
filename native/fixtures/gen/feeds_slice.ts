/**
 * One-time slicer for the feed golden inputs (60 §7.1 GF-1; 14 §13 V-1, V-2).
 * Writes small input slices under native/fixtures/feeds/ from the local data
 * roots (read-only symlinks into the fleet copy). The golden generator
 * (feeds_gen.ts) and the Rust tests read only these slices, so CI needs no
 * data roots. See native/fixtures/feeds/README.md.
 *
 * Usage: npx tsx native/fixtures/gen/feeds_slice.ts [--crafted-only]
 *   --crafted-only  rewrite only the crafted day files under crafted/ (no
 *                   data roots needed)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'
import { getInMemoryDuckDb, sqlQuote } from '../../../src/utils/duckdb.js'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'
import {
  FIXTURE_MARKETS,
  LOOKBACK_MS,
  BINANCE_TAIL_MS,
  CHAINLINK_TAIL_MS,
} from './feeds_markets.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const dataRoot = path.join(repoRoot, 'data')
const outRoot = path.join(repoRoot, 'native/fixtures/feeds')
/** Extra margin around the loader ranges so seeds and tails stay real. */
const MARGIN_MS = 2_000
/** Target number of kept real ticks per market (deterministic thinning). */
const TARGET_TICKS = 2_500

const DAY_MS = 86_400_000
const dateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
function daysCovering(startMs: number, endMs: number): string[] {
  const out: string[] = []
  let d = Math.floor(startMs / DAY_MS) * DAY_MS
  do {
    out.push(dateOf(d))
    d += DAY_MS
  } while (d < endMs)
  return out
}

const db = await getInMemoryDuckDb()
const conn = await db.connect()

async function sliceBinance(startMs: number, endMs: number): Promise<void> {
  const from = startMs - LOOKBACK_MS - MARGIN_MS
  const to = endMs + BINANCE_TAIL_MS + MARGIN_MS
  for (const day of daysCovering(startMs - LOOKBACK_MS, endMs)) {
    const src = path.join(dataRoot, `binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-${day}.parquet`)
    const dir = path.join(outRoot, 'binance/aggTrades/BTCUSDT')
    mkdirSync(dir, { recursive: true })
    const dst = path.join(dir, `BTCUSDT-aggTrades-${day}.parquet`)
    await conn.run(
      `COPY (SELECT agg_trade_id, price, ts_ms FROM read_parquet(${sqlQuote(src)})
             WHERE ts_ms BETWEEN ${from} AND ${to} ORDER BY agg_trade_id)
       TO ${sqlQuote(dst)} (FORMAT parquet, COMPRESSION zstd)`,
    )
  }
}

async function sliceChainlink(startMs: number, endMs: number): Promise<void> {
  const from = startMs - LOOKBACK_MS - MARGIN_MS
  const to = endMs + CHAINLINK_TAIL_MS + MARGIN_MS
  for (const day of daysCovering(startMs - LOOKBACK_MS, endMs)) {
    const src = path.join(
      dataRoot,
      `telonex/crypto_prices/btcusd/btcusd-crypto-prices-${day}.parquet`,
    )
    const dir = path.join(outRoot, 'telonex/crypto_prices/btcusd')
    mkdirSync(dir, { recursive: true })
    const dst = path.join(dir, `btcusd-crypto-prices-${day}.parquet`)
    await conn.run(
      `COPY (SELECT * FROM read_parquet(${sqlQuote(src)})
             WHERE timestamp_us BETWEEN ${from} * 1000 AND ${to} * 1000)
       TO ${sqlQuote(dst)} (FORMAT parquet, COMPRESSION zstd)`,
    )
  }
}

type Tick = { e: number; l: number | null; t: 0 | 1 }

/** Real tick clocks through the real TS reader (15 §4.2 oracle), thinned. */
async function sliceClocks(slug: string, startMs: number, endMs: number): Promise<void> {
  const file = path.join(dataRoot, `events/telonex/delta-typed/btc/15m/${slug}.parquet`)
  const all: Tick[] = []
  await replayTelonexDeltaParquetForMarket({
    filePath: file,
    onSnapshot: (snap, raw) => {
      const l = raw.source.kind === 'parquet' ? (raw.source.tsLocalMs ?? null) : null
      all.push({ e: snap.timestamp, l, t: raw.msg.event_type === 'book' ? 0 : 1 })
    },
  })
  const k = Math.max(1, Math.ceil(all.length / TARGET_TICKS))
  const keep = new Set<number>()
  for (let i = 0; i < all.length; i++) {
    const cur = all[i]!
    const prev = all[i - 1]
    if (i < 30 || i % k === 0 || i === all.length - 1) keep.add(i)
    // Local clock anomalies (14 F-8): keep the step and its neighbors.
    if (prev && cur.l !== null && prev.l !== null && cur.l < prev.l) {
      for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < all.length) keep.add(j)
    }
    // Window boundaries (inclusive gate, 12 §5.4): a few ticks around each.
    if (Math.abs(cur.e - startMs) <= 50 || Math.abs(cur.e - endMs) <= 50) keep.add(i)
  }
  const kept = [...keep].sort((a, b) => a - b).map((i) => all[i]!)
  let prevE = kept[0]!.e
  const ticks = kept.map((x) => {
    const row = [x.e - prevE, x.l === null ? null : x.l - x.e, x.t]
    prevE = x.e
    return row
  })
  const dir = path.join(outRoot, 'clocks')
  mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `${slug}.json`)
  const doc = {
    e0: kept[0]!.e,
    format: 'ticks[i] = [E_i - E_{i-1} (first: 0), L_i - E_i or null, 0 book | 1 price_change]',
    slug,
    sourceFile: `data/events/telonex/delta-typed/btc/15m/${slug}.parquet`,
    sourceTicks: all.length,
    thinning: `every ${k}th tick, the first 30, the last, +-2 around backward local steps, |E - start or end| <= 50 ms`,
    ticks,
  }
  // Prettier-formatted so `npm run code:prettier:check` passes (CI).
  const options = { ...(await resolveConfig(out)), parser: 'json' }
  writeFileSync(out, await format(JSON.stringify(doc), options))
  console.log(`${slug}: ${all.length} ticks -> ${kept.length}`)
}

/** Crafted loader inputs (14 V-1): tiny day files for edge cases. */
async function crafted(): Promise<void> {
  const root = path.join(outRoot, 'crafted')
  rmSync(root, { recursive: true, force: true })
  const bin = async (c: string, day: string, rows: [number, number, number | null][]) => {
    const dir = path.join(root, c, 'binance/aggTrades/BTCUSDT')
    mkdirSync(dir, { recursive: true })
    const values = rows
      .map(([id, ts, px]) => `(${id}::BIGINT, ${px === null ? 'NULL' : px}::DOUBLE, ${ts}::BIGINT)`)
      .join(', ')
    await conn.run(
      `COPY (SELECT * FROM (VALUES ${values}) t(agg_trade_id, price, ts_ms))
       TO ${sqlQuote(path.join(dir, `BTCUSDT-aggTrades-${day}.parquet`))} (FORMAT parquet)`,
    )
  }
  const cl = async (
    c: string,
    day: string,
    rows: [number | null, number | null, string][],
    assetByRound: Record<number, string> = {},
  ) => {
    const dir = path.join(root, c, 'telonex/crypto_prices/btcusd')
    mkdirSync(dir, { recursive: true })
    const sql = (v: number | null) => (v === null ? 'NULL' : String(v))
    const values = rows
      .map(
        ([r, b, px]) =>
          `(${sql(r)}::BIGINT, ${sql(b)}::BIGINT, ${sql(r)}::BIGINT, 'polymarket', '${(r !== null && assetByRound[r]) || 'btcusd'}', 'btc/usd', 'chainlink', '${px}')`,
      )
      .join(', ')
    await conn.run(
      `COPY (SELECT * FROM (VALUES ${values}) t(timestamp_us, server_timestamp_us, local_timestamp_us, exchange, asset_id, symbol, source, price))
       TO ${sqlQuote(path.join(dir, `btcusd-crypto-prices-${day}.parquet`))} (FORMAT parquet)`,
    )
  }
  // Window 2026-09-16T12:00Z (+15m); from = start - 300 s.
  const s = Date.parse('2026-09-16T12:00:00Z')
  const f = s - LOOKBACK_MS
  const e = s + 900_000
  // ts not monotone in id order, same-ms trades, seed = highest id before `from`.
  await bin('binance-nonmono', '2026-09-16', [
    [100, f - 60_000, 100.5],
    [101, f - 10, 101.25],
    [102, f - 500, 102],
    [103, f, 103.125],
    [104, f, 104],
    [105, s + 10, 105.5],
    [106, s + 5, 106],
    [107, e + BINANCE_TAIL_MS, 107],
    [108, e + BINANCE_TAIL_MS + 1, 108],
  ])
  // No trade at or before the window end: data_defect corrupt.
  await bin('binance-empty', '2026-09-16', [[1, e + 60_000, 1]])
  // Two-clock order, µs boundaries, seed by (broadcast, round).
  const us = (ms: number) => ms * 1000
  await cl('chainlink-twoclock', '2026-09-16', [
    [us(f) - 5_000_000, us(f) + 900_000, '117000.1'],
    [us(f) - 1_000_000, us(f) + 100_000, '117000.25'],
    [us(f) - 1, us(f) + 50_000, '117000.5'],
    [us(f), us(f) + 2_000_000, '117001.000000000000000001'],
    [us(f) + 1_000_000, us(f) + 1_500_000, '117002'],
    ...Array.from({ length: 5 }, (_, i): [number, number, string] => [
      us(s + i * 200_000),
      us(s + i * 200_000 + 1_100),
      `${117003 + i}.75`,
    ]),
    [us(e + CHAINLINK_TAIL_MS), us(e + CHAINLINK_TAIL_MS + 900), '117010'],
    [us(e + CHAINLINK_TAIL_MS) + 1, us(e + CHAINLINK_TAIL_MS + 950), '117011'],
  ])
  // A 400 s hole inside the window: upstream_hole at maxGapMs 300000.
  await cl('chainlink-hole', '2026-09-16', [
    [us(s - 1_000), us(s), '1.5'],
    [us(s + 100_000), us(s + 101_000), '2.5'],
    [us(s + 500_000), us(s + 501_000), '3.5'],
    [us(s + 800_000), us(s + 801_000), '4.5'],
    [us(e - 1_000), us(e), '5.5'],
  ])
  // NULL broadcast time on a member row: data_defect corrupt.
  await cl('chainlink-nullbc', '2026-09-16', [
    [us(s - 1_000), us(s), '1.5'],
    [us(s + 100_000), null, '2.5'],
  ])
  // A row without a round time: dropped by both engines (14 F-21, F-22).
  await cl('chainlink-nullround', '2026-09-16', [
    [us(f) - 2_000_000, us(f) - 1_000_000, '1.5'],
    [null, us(s), '9.5'],
    [us(s + 1_000), us(s + 2_000), '2.5'],
    [us(s + 250_000), us(s + 251_000), '3.5'],
    [us(s + 500_000), us(s + 501_000), '4.5'],
    [us(s + 750_000), us(s + 751_000), '5.5'],
    [us(e - 1_000), us(e), '6.5'],
  ])
  // Window 2026-09-17T00:00Z: the lookback and the seed lie in the
  // 2026-09-16 file, members in both files, broadcast order across files
  // (14 F-20, F-21, F-22).
  const m = Date.parse('2026-09-17T00:00:00Z')
  const mf = m - LOOKBACK_MS
  await cl('chainlink-twoday', '2026-09-16', [
    [us(mf - 3_000), us(mf - 2_000), '10.5'],
    [us(mf - 1_000), us(mf), '11.5'],
    [us(mf + 10), us(mf + 1_000), '12.5'],
    [us(m - 500), us(m + 1_500), '13.5'],
  ])
  await cl('chainlink-twoday', '2026-09-17', [
    [us(m + 100), us(m + 1_200), '14.5'],
    ...Array.from({ length: 4 }, (_, i): [number, number, string] => [
      us(m + (i + 1) * 200_000),
      us(m + (i + 1) * 200_000 + 1_000),
      `${15 + i}.25`,
    ]),
  ])
  // GF-5 divergences: inputs where TS loads but the spec makes the market
  // data_defect corrupt (14 F-17, F-25 and the D-PENDING row rules).
  const base: [number, number, number | null][] = [
    [200, f - 1_000, 200.5],
    [201, s, 201.5],
    [202, s + 100_000, 202.5],
  ]
  await bin('binance-nullprice', '2026-09-16', [...base, [203, s + 200_000, null]])
  await bin('binance-zeroprice', '2026-09-16', [...base, [203, s + 200_000, 0]])
  await bin('binance-negprice', '2026-09-16', [...base, [203, s + 200_000, -1.5]])
  // Identical duplicate rows keep the TS order deterministic.
  await bin('binance-dupid', '2026-09-16', [...base, [202, s + 100_000, 202.5]])
  // No stale span >= 300 s inside the window (14 F-26).
  const okRows: [number | null, number | null, string][] = [
    [us(s + 1_000), us(s + 2_000), '2.5'],
    [us(s + 250_000), us(s + 251_000), '3.5'],
    [us(s + 500_000), us(s + 501_000), '4.5'],
    [us(s + 750_000), us(s + 751_000), '5.5'],
    [us(e - 1_000), us(e), '6.5'],
  ]
  // The only pre-range row has a NULL broadcast time: it is the seed.
  await cl('chainlink-seed-nullbc', '2026-09-16', [[us(f) - 1_000_000, null, '1.5'], ...okRows])
  await cl('chainlink-zeroprice', '2026-09-16', [
    [us(f) - 1_000_000, us(f), '1.5'],
    [us(s + 500), us(s + 1_500), '0'],
    ...okRows,
  ])
  await cl(
    'chainlink-foreign-asset',
    '2026-09-16',
    [[us(f) - 1_000_000, us(f), '1.5'], ...okRows],
    { [us(s + 500_000)]: 'ethusd' },
  )
}

if (!process.argv.includes('--crafted-only')) {
  for (const m of FIXTURE_MARKETS) {
    await sliceBinance(m.startMs, m.endMs)
    if (m.chainlink) await sliceChainlink(m.startMs, m.endMs)
    await sliceClocks(m.slug, m.startMs, m.endMs)
  }
}
await crafted()
conn.closeSync()
