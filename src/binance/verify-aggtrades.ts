import '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import {
  aggTradesDayPath,
  pairFromFeedSymbol,
  recordingsDir,
  recordingStatusPath,
} from './paths.js'
import { downloadAggTradesDay } from './aggTradesDump.js'
import { loadBinanceAggTradesSeries } from '../backtest/feeds/binanceAggTradesSource.js'
import { createBacktestExternalFeedsProvider } from '../backtest/feeds/backtestExternalFeedsProvider.js'

/**
 * Prove the live-recorded Binance WS aggTrade stream identical to the
 * data.binance.vision daily dump — the core "backtest == live" evidence for
 * the Binance backtest feed.
 *
 *   npm run binance:verify-aggtrades -- --pair BTCUSDT --date 2026-07-16 [--download] [--check-asof]
 *
 * Joins recorded hourly parquet (binance:record-aggtrades) against the
 * converted dump on agg_trade_id inside the overlap window, trimmed by
 * WS-disconnect gaps from the status jsonl. Acceptance ("identical"):
 *   - 0 price/qty/ts mismatches (dump DOUBLE vs Number(recorded raw string))
 *   - 0 recorded rows absent from the dump
 *   - 0 dump rows absent from the recording outside excused disconnect gaps
 * Also prints the live latency distribution (received_at_ms − ts_ms), the
 * empirical input for BACKTEST_BINANCE_FEED_LATENCY_MS.
 */

type Args = { pair: string; date: string; download: boolean; checkAsof: boolean }

function parseArgs(argv: string[]): Args {
  let pair = ''
  let date = ''
  let download = false
  let checkAsof = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`missing value for ${a}`)
      return v
    }
    if (a === '--pair') pair = pairFromFeedSymbol(next())
    else if (a === '--symbol') pair = pairFromFeedSymbol(`${next()}usdt`)
    else if (a === '--date') date = next()
    else if (a === '--download') download = true
    else if (a === '--check-asof') checkAsof = true
    else throw new Error(`unknown arg: ${a}`)
  }
  if (!pair || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(
      'Usage: npm run binance:verify-aggtrades -- --pair BTCUSDT --date YYYY-MM-DD [--download] [--check-asof]',
    )
    process.exit(2)
  }
  return { pair, date, download, checkAsof }
}

function sqlQuote(s: string): string {
  return `'${s.replaceAll("'", "''")}'`
}

/** Excused intervals (ms) where the recorder was not connected, from the status jsonl. */
async function loadDisconnectGaps(pair: string): Promise<Array<{ fromMs: number; toMs: number }>> {
  const MARGIN_MS = 2_000
  let raw: string
  try {
    raw = await fs.readFile(recordingStatusPath(pair), 'utf8')
  } catch {
    return []
  }
  const events: Array<{ ts_ms: number; kind: string }> = []
  const gaps: Array<{ fromMs: number; toMs: number }> = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line) as {
        ts_ms?: number
        kind?: string
        gap_from_ms?: number
        gap_to_ms?: number
      }
      if (typeof o.ts_ms !== 'number' || typeof o.kind !== 'string') continue
      // Machine-sleep freezes carry their own interval (recorder heartbeat).
      if (o.kind === 'clock-jump') {
        if (typeof o.gap_from_ms === 'number' && typeof o.gap_to_ms === 'number') {
          gaps.push({ fromMs: o.gap_from_ms - MARGIN_MS, toMs: o.gap_to_ms + MARGIN_MS })
        }
        continue
      }
      events.push({ ts_ms: o.ts_ms, kind: o.kind })
    } catch {
      // tolerate torn writes
    }
  }
  events.sort((a, b) => a.ts_ms - b.ts_ms)
  let gapStart: number | null = null
  for (const e of events) {
    if (e.kind === 'connected') {
      if (gapStart !== null) {
        gaps.push({ fromMs: gapStart - MARGIN_MS, toMs: e.ts_ms + MARGIN_MS })
        gapStart = null
      }
    } else if (
      e.kind === 'reconnecting' ||
      e.kind === 'disconnected' ||
      e.kind === 'recorder-stop'
    ) {
      gapStart ??= e.ts_ms
    }
  }
  if (gapStart !== null) gaps.push({ fromMs: gapStart - MARGIN_MS, toMs: Number.MAX_SAFE_INTEGER })
  return gaps
}

function rowsOf(result: {
  chunkCount: number
  getChunk: (i: number) => { getRows: () => unknown[][] }
}): unknown[][] {
  const out: unknown[][] = []
  for (let c = 0; c < result.chunkCount; c++) out.push(...result.getChunk(c).getRows())
  return out
}

async function checkAsOfCorrectness(args: {
  conn: DuckDBConnection
  pair: string
  dumpPath: string
  fromMs: number
  toMs: number
}): Promise<number> {
  const SAMPLES = 1_000
  const series = await loadBinanceAggTradesSeries({
    pair: args.pair,
    startMs: args.fromMs,
    endMs: args.toMs,
    lookbackMs: 0,
  })
  const provider = createBacktestExternalFeedsProvider({
    binanceWsSpotPrice: { symbol: args.pair.toLowerCase(), series, latencyOffsetMs: 0 },
  })
  // Ascending timestamps exercise the monotonic cursor (the replay pattern);
  // a deterministic LCG keeps the sample reproducible.
  let seed = 0x9e3779b9
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  const ts = Array.from(
    { length: SAMPLES },
    () => args.fromMs + Math.floor(rand() * (args.toMs - args.fromMs)),
  ).sort((a, b) => a - b)

  let mismatches = 0
  for (const t of ts) {
    const got = provider.snapshotAt(t).binanceWsSpotPrice?.value ?? null
    const res = await args.conn.run(
      `SELECT price FROM read_parquet(${sqlQuote(args.dumpPath)})
       WHERE ts_ms <= ${t} AND ts_ms >= ${args.fromMs}
       ORDER BY agg_trade_id DESC LIMIT 1`,
    )
    const rows = rowsOf(res)
    const expected = rows.length > 0 ? Number(rows[0]![0]) : null
    if (got !== expected) {
      mismatches++
      if (mismatches <= 5) {
        console.error(`  [check-asof] t=${t} provider=${got} sql=${expected}`)
      }
    }
  }
  return mismatches
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.download) {
    const res = await downloadAggTradesDay({ pair: args.pair, isoDate: args.date })
    if (res.status === 'skipped-not-published') {
      console.error(
        `[binance:verify] dump for ${args.pair} ${args.date} is not published yet (~1-day lag) — retry later`,
      )
      process.exit(3)
    }
    console.log(`[binance:verify] dump ${res.status}: ${res.parquetPath}`)
  }

  const dumpPath = aggTradesDayPath(args.pair, args.date)
  try {
    await fs.stat(dumpPath)
  } catch {
    console.error(`[binance:verify] dump parquet missing: ${dumpPath} (run with --download)`)
    process.exit(2)
  }

  const recDir = recordingsDir(args.pair)
  const recFiles = (await fs.readdir(recDir).catch(() => [] as string[]))
    .filter((f) => f.includes('-aggTrades-live-') && f.endsWith('.parquet'))
    .map((f) => path.join(recDir, f))
  if (recFiles.length === 0) {
    console.error(`[binance:verify] no recorded parquet files in ${recDir}`)
    process.exit(2)
  }

  const db = await DuckDBInstance.create(':memory:')
  const conn = await db.connect()
  const recGlob = `[${recFiles.map(sqlQuote).join(', ')}]`

  // Overlap window: both sides have full coverage inside it.
  const boundsRes = await conn.run(`
    WITH rec AS (SELECT min(ts_ms) a, max(ts_ms) b FROM read_parquet(${recGlob})),
         dump AS (SELECT min(ts_ms) a, max(ts_ms) b FROM read_parquet(${sqlQuote(dumpPath)}))
    SELECT greatest(rec.a, dump.a), least(rec.b, dump.b) FROM rec, dump
  `)
  const bounds = rowsOf(boundsRes)[0]!
  const fromMs = Number(bounds[0])
  const toMs = Number(bounds[1])
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    console.error(
      `[binance:verify] no time overlap between recording and dump for ${args.date} — record longer or pick the recorded date`,
    )
    process.exit(3)
  }
  const overlapMin = ((toMs - fromMs) / 60_000).toFixed(1)
  console.log(
    `[binance:verify] overlap ${new Date(fromMs).toISOString()} .. ${new Date(toMs).toISOString()} (${overlapMin} min)`,
  )

  const gaps = await loadDisconnectGaps(args.pair)
  const gapPredicate =
    gaps.length === 0
      ? 'FALSE'
      : gaps.map((g) => `(d.ts_ms BETWEEN ${g.fromMs} AND ${g.toMs})`).join(' OR ')
  if (gaps.length > 0) {
    console.log(`[binance:verify] ${gaps.length} disconnect gap(s) excused (±2s margin)`)
  }

  const joinRes = await conn.run(`
    WITH rec AS (
      SELECT agg_trade_id, CAST(price AS DOUBLE) price, CAST(qty AS DOUBLE) qty, ts_ms,
             received_at_ms
      FROM read_parquet(${recGlob})
      WHERE ts_ms BETWEEN ${fromMs} AND ${toMs}
    ),
    d AS (
      SELECT agg_trade_id, price, qty, ts_ms
      FROM read_parquet(${sqlQuote(dumpPath)})
      WHERE ts_ms BETWEEN ${fromMs} AND ${toMs}
    ),
    j AS (
      SELECT rec.agg_trade_id rid, d.agg_trade_id did,
             rec.price rp, d.price dp, rec.qty rq, d.qty dq,
             rec.ts_ms rts, d.ts_ms dts,
             CASE WHEN d.agg_trade_id IS NOT NULL AND rec.agg_trade_id IS NULL
                  AND (${gapPredicate}) THEN 1 ELSE 0 END AS excused
      FROM rec FULL OUTER JOIN d ON rec.agg_trade_id = d.agg_trade_id
    )
    SELECT
      count(*) FILTER (WHERE rid IS NOT NULL AND did IS NOT NULL)                    AS matched,
      count(*) FILTER (WHERE rid IS NOT NULL AND did IS NULL)                        AS missing_in_dump,
      count(*) FILTER (WHERE did IS NOT NULL AND rid IS NULL AND excused = 0)        AS missing_in_recorded,
      count(*) FILTER (WHERE did IS NOT NULL AND rid IS NULL AND excused = 1)        AS missing_excused,
      count(*) FILTER (WHERE rid IS NOT NULL AND did IS NOT NULL AND rp <> dp)       AS price_mismatch,
      count(*) FILTER (WHERE rid IS NOT NULL AND did IS NOT NULL AND rq <> dq)       AS qty_mismatch,
      count(*) FILTER (WHERE rid IS NOT NULL AND did IS NOT NULL AND rts <> dts)     AS ts_mismatch
    FROM j
  `)
  const j = rowsOf(joinRes)[0]!.map(Number)
  const [matched, missingInDump, missingInRecorded, missingExcused, priceMm, qtyMm, tsMm] = j as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]

  console.log('[binance:verify] join on agg_trade_id within overlap:')
  console.log(`  matched              ${matched}`)
  console.log(`  price_mismatch       ${priceMm}`)
  console.log(`  qty_mismatch         ${qtyMm}`)
  console.log(`  ts_mismatch          ${tsMm}`)
  console.log(`  missing_in_dump      ${missingInDump}   (recorded rows absent from the dump)`)
  console.log(
    `  missing_in_recorded  ${missingInRecorded}   (dump rows the recorder never saw, outside gaps)`,
  )
  console.log(`  missing_excused      ${missingExcused}   (inside disconnect gaps)`)

  const latRes = await conn.run(`
    SELECT
      quantile_cont(lat, 0.50), quantile_cont(lat, 0.90), quantile_cont(lat, 0.95),
      quantile_cont(lat, 0.99), min(lat), max(lat), avg(lat)
    FROM (
      SELECT received_at_ms - ts_ms AS lat
      FROM read_parquet(${recGlob})
      WHERE ts_ms BETWEEN ${fromMs} AND ${toMs}
    )
  `)
  const lat = rowsOf(latRes)[0]!.map(Number)
  console.log('[binance:verify] live latency received_at_ms − ts_ms (ms):')
  console.log(
    `  p50=${lat[0]} p90=${lat[1]} p95=${lat[2]} p99=${lat[3]} min=${lat[4]} max=${lat[5]} avg=${lat[6]?.toFixed(1)}`,
  )
  console.log(`  → BACKTEST_BINANCE_FEED_LATENCY_MS candidate (p50): ${Math.round(lat[0] ?? 0)}`)

  let asofMismatches = 0
  if (args.checkAsof) {
    console.log('[binance:verify] as-of correctness: 1000 sampled timestamps vs SQL...')
    asofMismatches = await checkAsOfCorrectness({ conn, pair: args.pair, dumpPath, fromMs, toMs })
    console.log(`  as-of mismatches: ${asofMismatches}`)
  }

  conn.closeSync()

  const pass =
    priceMm === 0 &&
    qtyMm === 0 &&
    tsMm === 0 &&
    missingInDump === 0 &&
    missingInRecorded === 0 &&
    asofMismatches === 0
  console.log(
    pass
      ? '[binance:verify] PASS — live stream and dump are identical within the overlap window'
      : '[binance:verify] FAIL — see counters above',
  )
  process.exit(pass ? 0 : 1)
}

main().catch((err) => {
  console.error('[binance:verify] fatal:', err)
  process.exit(1)
})
