import '../../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { sqlQuote } from '../../utils/duckdb.js'
import { parseCryptoPricesCliArgs } from './cliArgs.js'
import { cryptoPricesDayPath, recordingStatusPath, recordingsDir } from './paths.js'

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

type Args = { assetId: string; date: string }

function parseArgs(argv: string[]): Args {
  let date = ''
  const { assetId } = parseCryptoPricesCliArgs({
    argv,
    usage: 'Usage: npm run telonex:crypto-prices:verify -- --asset btcusd --date YYYY-MM-DD',
    flags: {
      '--date': { kind: 'value', set: (v) => (date = v) },
    },
  })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: npm run telonex:crypto-prices:verify -- --asset btcusd --date YYYY-MM-DD')
    process.exit(2)
  }
  return { assetId, date }
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

  conn.closeSync()

  const pass = valueMm === 0 && missingInTelonex === 0 && missingInRecording === 0
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
