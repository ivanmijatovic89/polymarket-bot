import '../../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { sqlQuote } from '../../utils/duckdb.js'
import { closeDb } from '../../db/index.js'
import { listResolvedMarketsForChainlinkCheck } from '../../db/telonexMarkets.js'
import { timeframeMsFromSlug } from '../../polymarket/upDownSlugWindow.js'
import { loadChainlinkCryptoPricesSeries } from '../../backtest/feeds/chainlinkCryptoPricesSource.js'
import { createBacktestExternalFeedsProvider } from '../../backtest/feeds/backtestExternalFeedsProvider.js'
import { parseCryptoPricesCliArgs } from './cliArgs.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  cryptoPricesDayPath,
  recordingStatusPath,
  recordingsDir,
} from './paths.js'

/**
 * Prove the live-recorded RTDS `crypto_prices_chainlink` stream identical to
 * the Telonex `crypto_prices` day file — the core "backtest == live" evidence
 * for the Chainlink backtest feed — and measure the broadcast→bot latency
 * that `BACKTEST_RTDS_CHAINLINK_LATENCY_MS` models.
 *
 *   npm run telonex:crypto-prices:verify -- --asset btcusd --date 2026-07-20
 *
 * Join key: the chainlink ROUND time per symbol — recorded `ts_ms` vs telonex
 * `timestamp_us // 1000`. Both sides are deduped to the last row per round
 * first (reconnect replays / re-broadcasts keep the highest broadcast time —
 * live last-write-wins), then FULL OUTER JOINed inside the overlap window,
 * trimmed by disconnect/clock-jump gaps from the recorder status jsonl.
 *
 * Acceptance ("identical"): 0 value mismatches, 0 recorded rounds absent from
 * Telonex, 0 Telonex rounds absent from the recording outside excused gaps.
 * Exit 0 only then.
 *
 * Latency percentiles are printed for BOTH legs:
 *  - `received_at_ms − server_ts_ms` — the broadcast→bot leg; its p50 is the
 *    empirical default for BACKTEST_RTDS_CHAINLINK_LATENCY_MS.
 *  - `received_at_ms − ts_ms` — total round→bot (sanity ≈ 1s structural
 *    broadcast lag + the bot leg).
 *
 * NOTE: the Telonex file for recording day D publishes on D+1 (daily after
 * midnight UTC) — record today, verify tomorrow (same two-phase flow as
 * `binance:verify-aggtrades`).
 */

type Args = {
  assetId: string
  date: string
  checkAsof: boolean
  resolutionCheck: boolean
  timeframe: string
  limit: number
}

const USAGE =
  'Usage: npm run telonex:crypto-prices:verify -- --asset btcusd (--date YYYY-MM-DD [--check-asof] | --resolution-check [--timeframe 15m] [--limit 500])'

function parseArgs(argv: string[]): Args {
  let date = ''
  let checkAsof = false
  let resolutionCheck = false
  let timeframe = '15m'
  let limit = 500
  const { assetId } = parseCryptoPricesCliArgs({
    argv,
    usage: USAGE,
    flags: {
      '--date': { kind: 'value', set: (v) => (date = v) },
      '--check-asof': { kind: 'boolean', set: () => (checkAsof = true) },
      '--resolution-check': { kind: 'boolean', set: () => (resolutionCheck = true) },
      '--timeframe': { kind: 'value', set: (v) => (timeframe = v.trim()) },
      '--limit': { kind: 'value', set: (v) => (limit = Math.max(1, Number(v) || 500)) },
    },
  })
  if (!resolutionCheck && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(USAGE)
    process.exit(2)
  }
  return { assetId, date, checkAsof, resolutionCheck, timeframe, limit }
}

/**
 * As-of correctness: the loader+provider pair (the exact code path backtests
 * use) must answer every sampled timestamp identically to a reference SQL
 * query over the raw day file — checking BOTH the value and the emitted
 * round-`tsMs`, at offset 0 and at a nonzero offset. Deterministic LCG sample,
 * ascending (the replay pattern) with periodic backwards jumps spliced in to
 * exercise the binary-search fallback.
 */
async function checkAsOfCorrectness(args: {
  conn: import('@duckdb/node-api').DuckDBConnection
  assetId: string
  dayPath: string
  fromMs: number
  toMs: number
}): Promise<number> {
  const SAMPLES = 1_000
  let totalMismatches = 0
  for (const latencyOffsetMs of [0, 100]) {
    const series = await loadChainlinkCryptoPricesSeries({
      assetId: args.assetId,
      startMs: args.fromMs,
      endMs: args.toMs,
      lookbackMs: 0,
    })
    const provider = createBacktestExternalFeedsProvider({
      rtdsChainlink: { symbol: 'btc/usd', series, latencyOffsetMs },
    })
    let seed = 0x9e3779b9
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xffffffff
    }
    const ts = Array.from(
      { length: SAMPLES },
      () => args.fromMs + Math.floor(rand() * (args.toMs - args.fromMs)),
    ).sort((a, b) => a - b)
    for (let i = 100; i < ts.length; i += 100) ts.splice(i, 0, ts[i - 50]!)

    let mismatches = 0
    let clockHighWater = Number.NEGATIVE_INFINITY
    for (const t of ts) {
      const snap = provider.snapshotAt(t).rtdsPolymarketCryptoPrices?.chainlink
      // The provider clamps to its monotone high-water clock — mirror it in
      // the reference query so backwards samples compare like-for-like.
      clockHighWater = Math.max(clockHighWater, t)
      const res = await args.conn.run(
        `SELECT CAST(price AS DOUBLE), timestamp_us // 1000
         FROM read_parquet(${sqlQuote(args.dayPath)})
         WHERE server_timestamp_us // 1000 + ${latencyOffsetMs} <= ${clockHighWater}
           AND timestamp_us >= ${args.fromMs} * 1000
         ORDER BY server_timestamp_us DESC, timestamp_us DESC LIMIT 1`,
      )
      const rows = rowsOf(res)
      const expValue = rows.length > 0 ? Number(rows[0]![0]) : null
      const expTsMs = rows.length > 0 ? Number(rows[0]![1]) : null
      const gotValue = snap?.value ?? null
      const gotTsMs = snap?.tsMs ?? null
      if (gotValue !== expValue || gotTsMs !== expTsMs) {
        mismatches++
        if (mismatches <= 5) {
          console.error(
            `  [check-asof offset=${latencyOffsetMs}] t=${t} provider=${gotValue}@${gotTsMs} sql=${expValue}@${expTsMs}`,
          )
        }
      }
    }
    console.log(
      `  [check-asof] offset=${latencyOffsetMs}ms: ${ts.length} samples, mismatches=${mismatches}`,
    )
    totalMismatches += mismatches
  }
  return totalMismatches
}

/**
 * Resolution replication + Gamma cross-checks — the strongest end-to-end
 * proof that this series is THE feed Polymarket resolves with:
 *
 * For each resolved market: open = last round at-or-before window start,
 * close = last round at-or-before window end (round clock — resolution is
 * about the oracle series itself, not delivery latency). Then:
 *  - derived outcome sign(close − open) vs telonex `result_id` (G),
 *  - chainlink open vs Gamma `price_to_beat` (F),
 *  - chainlink close vs Gamma `final_price` (F).
 */
async function resolutionCheck(args: {
  assetId: string
  timeframe: string
  limit: number
}): Promise<boolean> {
  const symbol = args.assetId.replace(/usd$/, '')
  const markets = await listResolvedMarketsForChainlinkCheck({
    symbol,
    timeframe: args.timeframe,
    fromMs: CRYPTO_PRICES_COVERAGE_FROM_MS,
    limit: args.limit,
  })
  if (markets.length === 0) {
    console.error(
      `[crypto-prices:verify] no resolved ${symbol}/${args.timeframe} markets after coverage start — nothing to check`,
    )
    return false
  }
  const tfMs = timeframeMsFromSlug(markets[0]!.slug)
  if (!tfMs) {
    console.error(`[crypto-prices:verify] cannot parse timeframe from slug ${markets[0]!.slug}`)
    return false
  }

  const db = await DuckDBInstance.create(':memory:')
  const conn = await db.connect()
  let agree = 0
  let disagree = 0
  let ties = 0
  let skippedNoData = 0
  let strikeChecked = 0
  let strikeExact = 0
  let maxStrikeDiff = 0
  let closeChecked = 0
  let closeExact = 0
  let maxCloseDiff = 0
  const disagreements: string[] = []

  try {
    for (const m of markets) {
      const startMs = m.marketStartMs
      const endMs = startMs + tfMs
      let series
      try {
        series = await loadChainlinkCryptoPricesSeries({
          assetId: args.assetId,
          startMs,
          endMs,
          lookbackMs: 300_000,
        })
      } catch {
        skippedNoData++
        continue
      }
      // Open/close on the ROUND clock (the oracle series itself).
      let open: number | null = null
      let openTs = Number.NEGATIVE_INFINITY
      let close: number | null = null
      let closeTs = Number.NEGATIVE_INFINITY
      for (let i = 0; i < series.length; i++) {
        const ts = series.tsMs[i]!
        if (ts <= startMs && ts >= openTs) {
          openTs = ts
          open = series.value[i]!
        }
        if (ts <= endMs && ts >= closeTs) {
          closeTs = ts
          close = series.value[i]!
        }
      }
      if (open === null || close === null) {
        skippedNoData++
        continue
      }
      const derived = close > open ? '0' : close < open ? '1' : 'tie'
      if (derived === 'tie') ties++
      else if (derived === m.resultId) agree++
      else {
        disagree++
        if (disagreements.length < 5) {
          disagreements.push(
            `${m.slug}: derived=${derived === '0' ? 'UP' : 'DOWN'} actual=${m.resultId === '0' ? 'UP' : 'DOWN'} open=${open} close=${close}`,
          )
        }
      }
      if (m.priceToBeat !== null) {
        strikeChecked++
        const diff = Math.abs(open - m.priceToBeat)
        if (diff === 0) strikeExact++
        maxStrikeDiff = Math.max(maxStrikeDiff, diff)
      }
      if (m.finalPrice !== null) {
        closeChecked++
        const diff = Math.abs(close - m.finalPrice)
        if (diff === 0) closeExact++
        maxCloseDiff = Math.max(maxCloseDiff, diff)
      }
    }
  } finally {
    conn.closeSync()
  }

  const decided = agree + disagree
  const pct = decided > 0 ? (agree / decided) * 100 : 0
  console.log(
    `[crypto-prices:verify] resolution replication (${symbol}/${args.timeframe}, ${markets.length} resolved markets):`,
  )
  console.log(
    `  outcome agreement     ${agree}/${decided} (${pct.toFixed(2)}%)  ties=${ties} skipped-no-data=${skippedNoData}`,
  )
  for (const d of disagreements) console.log(`    disagreement: ${d}`)
  console.log(
    `  strike vs chainlink@open   checked=${strikeChecked} exact=${strikeExact} max|diff|=${maxStrikeDiff}`,
  )
  console.log(
    `  finalPrice vs chainlink@close checked=${closeChecked} exact=${closeExact} max|diff|=${maxCloseDiff}`,
  )
  const pass = decided > 0 && pct >= 99
  console.log(
    pass
      ? '[crypto-prices:verify] RESOLUTION CHECK PASS (≥99% agreement)'
      : '[crypto-prices:verify] RESOLUTION CHECK FAIL',
  )
  return pass
}

/**
 * Excused intervals (ms) where the recorder was not connected or was frozen
 * (machine sleep), from the status jsonl. Same semantics as the binance
 * verifier: disconnect→connected intervals, explicit clock-jump intervals,
 * and everything after a final unresumed stop.
 */
async function loadDisconnectGaps(
  assetId: string,
): Promise<Array<{ fromMs: number; toMs: number }>> {
  const MARGIN_MS = 2_000
  let raw: string
  try {
    raw = await fs.readFile(recordingStatusPath(assetId), 'utf8')
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.resolutionCheck) {
    const ok = await resolutionCheck({
      assetId: args.assetId,
      timeframe: args.timeframe,
      limit: args.limit,
    })
    await closeDb()
    process.exit(ok ? 0 : 1)
  }

  const dayPath = cryptoPricesDayPath(args.assetId, args.date)
  try {
    await fs.stat(dayPath)
  } catch {
    console.error(
      `[crypto-prices:verify] telonex day file missing: ${dayPath}\n` +
        `Fetch it with: npm run telonex:crypto-prices:download -- --asset ${args.assetId} --from ${args.date}` +
        ` (publishes daily after midnight UTC — a same-day recording verifies tomorrow)`,
    )
    process.exit(2)
  }

  const recDir = recordingsDir(args.assetId)
  const recFiles = (await fs.readdir(recDir).catch(() => [] as string[]))
    .filter((f) => f.includes('-rtds-chainlink-') && f.endsWith('.parquet'))
    .map((f) => path.join(recDir, f))
  if (recFiles.length === 0) {
    console.error(
      `[crypto-prices:verify] no recorded parquet files in ${recDir} — run telonex:crypto-prices:record-rtds first`,
    )
    process.exit(2)
  }

  const db = await DuckDBInstance.create(':memory:')
  const conn = await db.connect()
  const recGlob = `[${recFiles.map(sqlQuote).join(', ')}]`

  // Dedupe BOTH sides to the last row per round before anything else:
  // reconnect replays (recorder) and re-broadcasts (RTDS) are live-legal,
  // and last-write-wins is exactly what the live store serves.
  const setup = `
    CREATE TEMP VIEW rec AS
      SELECT ts_ms,
             arg_max(value, (coalesce(server_ts_ms, ts_ms), received_at_ms)) AS value,
             arg_max(server_ts_ms, (coalesce(server_ts_ms, ts_ms), received_at_ms)) AS server_ts_ms,
             arg_max(received_at_ms, (coalesce(server_ts_ms, ts_ms), received_at_ms)) AS received_at_ms
      FROM read_parquet(${recGlob})
      GROUP BY ts_ms;
    CREATE TEMP VIEW tx AS
      SELECT timestamp_us // 1000 AS ts_ms,
             arg_max(CAST(price AS DOUBLE), server_timestamp_us) AS value,
             arg_max(server_timestamp_us // 1000, server_timestamp_us) AS server_ts_ms
      FROM read_parquet(${sqlQuote(dayPath)})
      GROUP BY timestamp_us // 1000;
  `
  await conn.run(setup)

  const boundsRes = await conn.run(`
    SELECT greatest((SELECT min(ts_ms) FROM rec), (SELECT min(ts_ms) FROM tx)),
           least((SELECT max(ts_ms) FROM rec), (SELECT max(ts_ms) FROM tx))
  `)
  const bounds = rowsOf(boundsRes)[0]!
  const fromMs = Number(bounds[0])
  const toMs = Number(bounds[1])
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    console.error(
      `[crypto-prices:verify] no time overlap between the recording and the ${args.date} telonex file — ` +
        `record longer or pick the recorded date`,
    )
    process.exit(3)
  }
  console.log(
    `[crypto-prices:verify] overlap ${new Date(fromMs).toISOString()} .. ${new Date(toMs).toISOString()} (${((toMs - fromMs) / 60_000).toFixed(1)} min)`,
  )

  const gaps = await loadDisconnectGaps(args.assetId)
  const gapPredicate =
    gaps.length === 0
      ? 'FALSE'
      : gaps.map((g) => `(t.ts_ms BETWEEN ${g.fromMs} AND ${g.toMs})`).join(' OR ')
  if (gaps.length > 0) {
    console.log(
      `[crypto-prices:verify] ${gaps.length} disconnect/clock-jump gap(s) excused (±2s margin)`,
    )
  }

  const joinRes = await conn.run(`
    WITH r AS (SELECT * FROM rec WHERE ts_ms BETWEEN ${fromMs} AND ${toMs}),
         t AS (SELECT * FROM tx WHERE ts_ms BETWEEN ${fromMs} AND ${toMs}),
         j AS (
           SELECT r.ts_ms AS rts, t.ts_ms AS tts, r.value AS rv, t.value AS tv,
                  r.server_ts_ms AS r_server, t.server_ts_ms AS t_server,
                  CASE WHEN t.ts_ms IS NOT NULL AND r.ts_ms IS NULL
                       AND (${gapPredicate}) THEN 1 ELSE 0 END AS excused
           FROM r FULL OUTER JOIN t ON r.ts_ms = t.ts_ms
         )
    SELECT
      count(*) FILTER (WHERE rts IS NOT NULL AND tts IS NOT NULL)                 AS matched,
      count(*) FILTER (WHERE rts IS NOT NULL AND tts IS NULL)                     AS missing_in_telonex,
      count(*) FILTER (WHERE tts IS NOT NULL AND rts IS NULL AND excused = 0)     AS missing_in_recording,
      count(*) FILTER (WHERE tts IS NOT NULL AND rts IS NULL AND excused = 1)     AS missing_excused,
      count(*) FILTER (WHERE rts IS NOT NULL AND tts IS NOT NULL AND rv <> tv)    AS value_mismatch,
      count(*) FILTER (WHERE rts IS NOT NULL AND tts IS NOT NULL AND r_server IS NOT NULL AND r_server <> t_server) AS server_ts_mismatch
    FROM j
  `)
  const j = rowsOf(joinRes)[0]!.map(Number)
  const [matched, missingInTelonex, missingInRecording, missingExcused, valueMm, serverTsMm] =
    j as [number, number, number, number, number, number]

  console.log('[crypto-prices:verify] join on chainlink round time within overlap:')
  console.log(`  matched               ${matched}`)
  console.log(`  value_mismatch        ${valueMm}`)
  console.log(`  server_ts_mismatch    ${serverTsMm}   (informational — broadcast clocks)`)
  console.log(`  missing_in_telonex    ${missingInTelonex}   (recorded rounds absent from telonex)`)
  console.log(
    `  missing_in_recording  ${missingInRecording}   (telonex rounds the recorder never saw, outside gaps)`,
  )
  console.log(`  missing_excused       ${missingExcused}   (inside disconnect/clock-jump gaps)`)

  const latRes = await conn.run(`
    SELECT
      quantile_cont(bot_leg, 0.50), quantile_cont(bot_leg, 0.90), quantile_cont(bot_leg, 0.95),
      quantile_cont(bot_leg, 0.99), min(bot_leg), max(bot_leg), avg(bot_leg),
      quantile_cont(total, 0.50), quantile_cont(total, 0.99)
    FROM (
      SELECT received_at_ms - server_ts_ms AS bot_leg,
             received_at_ms - ts_ms AS total
      FROM rec
      WHERE ts_ms BETWEEN ${fromMs} AND ${toMs} AND server_ts_ms IS NOT NULL
    )
  `)
  const lat = rowsOf(latRes)[0]!.map(Number)
  console.log('[crypto-prices:verify] latency — broadcast→bot leg (received_at − server_ts, ms):')
  console.log(
    `  p50=${lat[0]} p90=${lat[1]} p95=${lat[2]} p99=${lat[3]} min=${lat[4]} max=${lat[5]} avg=${lat[6]?.toFixed(1)}`,
  )
  console.log(`  → BACKTEST_RTDS_CHAINLINK_LATENCY_MS candidate (p50): ${Math.round(lat[0] ?? 0)}`)
  console.log(
    `[crypto-prices:verify] latency — total round→bot (received_at − round_ts, ms): p50=${lat[7]} p99=${lat[8]} (≈1s structural broadcast lag + bot leg)`,
  )

  let asofMismatches = 0
  if (args.checkAsof) {
    console.log('[crypto-prices:verify] as-of correctness: sampled timestamps vs reference SQL...')
    asofMismatches = await checkAsOfCorrectness({
      conn,
      assetId: args.assetId,
      dayPath,
      fromMs,
      toMs,
    })
  }

  conn.closeSync()

  const pass =
    valueMm === 0 && missingInTelonex === 0 && missingInRecording === 0 && asofMismatches === 0
  console.log(
    pass
      ? '[crypto-prices:verify] PASS — live stream and telonex file are identical within the overlap window'
      : '[crypto-prices:verify] FAIL — see counters above',
  )
  process.exit(pass ? 0 : 1)
}

main().catch((err) => {
  console.error('[crypto-prices:verify] fatal:', err)
  process.exit(1)
})
