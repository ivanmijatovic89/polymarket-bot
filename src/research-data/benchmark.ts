import { performance } from 'node:perf_hooks'
import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { dates, parseDate } from './catalog.js'
import { readJson } from './files.js'
import { loadIndex, openDataset } from './storage.js'

/** Measures local queries and projects observed full-day sync reports. */
export async function benchmarkDataset(root: string, from: string, to: string, projectDays = 122) {
  const index = await loadIndex(root)
  const required = dates(from, to)
  const reports = []
  for (const date of required) {
    const snapshot = index.days[date]
    if (!snapshot) throw new Error(`Cannot benchmark missing day: ${date}`)
    const report = await readJson<Record<string, unknown>>(path.join(root, snapshot.report))
    if (!report) throw new Error(`Missing benchmark report: ${date}`)
    reports.push({
      date,
      source_as_of: snapshot.as_of,
      elapsed_seconds: Number(report.elapsed_seconds),
      resumed: report.resumed_from_checkpoint === true,
      shared_wallet_queue: report.wallet_batch_scope === 'update',
      requests: Number((report.api as { requests: number }).requests),
      retries: Number((report.api as { retries: number }).retries),
      parquet_bytes: snapshot.parquet_bytes,
      measured_peak_working_bytes: Number(report.measured_peak_working_bytes),
      trade_rows: Number(report.trade_rows),
      wallets: Number(report.wallets),
      unresolved_wallet_markets: snapshot.unresolved_wallet_markets,
      open_position_scope: report.open_position_scope ?? 'wallet',
    })
  }
  const startup = performance.now()
  const { connection, close } = await openDataset(root)
  const openMs = performance.now() - startup
  const range = `market_start >= ${parseDate(from)} AND market_start < ${parseDate(to)}`
  const queries: { name: string; first_ms: number; repeat_ms: number[]; result_rows: number }[] = []
  try {
    const definitions = [
      [
        'trade_scan',
        `SELECT count(*) AS trades, count(DISTINCT proxy_wallet) AS wallets FROM trades JOIN markets USING(condition_id) WHERE ${range}`,
      ],
      [
        'wallet_ranking',
        `SELECT wallet, sum(economic_pnl_usdc) AS pnl FROM wallet_markets WHERE ${range} GROUP BY wallet ORDER BY pnl DESC, wallet LIMIT 100`,
      ],
      [
        'activity_timeline',
        `SELECT a.timestamp,a.type,a.side,a.size,a.usdc_size FROM activities a JOIN markets m USING(condition_id) WHERE ${range} AND a.proxy_wallet = (SELECT wallet FROM wallet_markets WHERE ${range} ORDER BY trade_count DESC, wallet LIMIT 1) ORDER BY a.timestamp,a.row_index LIMIT 1000`,
      ],
    ] as const
    for (const [name, sql] of definitions) {
      const times = []
      let rows = 0
      for (let run = 0; run < 3; run++) {
        const start = performance.now()
        rows = (await connection.runAndReadAll(sql)).getRowObjectsJson().length
        times.push(performance.now() - start)
      }
      queries.push({ name, first_ms: times[0]!, repeat_ms: times.slice(1), result_rows: rows })
    }
  } finally {
    close()
  }
  const fresh = reports.filter((report) => !report.resumed && !report.shared_wallet_queue)
  const fs = await statfs(root)
  const projected = (key: 'elapsed_seconds' | 'requests' | 'parquet_bytes') => {
    const values = fresh.map((r) => r[key])
    return values.length
      ? {
          mean: (values.reduce((a, b) => a + b, 0) / values.length) * projectDays,
          observed_low: Math.min(...values) * projectDays,
          observed_high: Math.max(...values) * projectDays,
        }
      : null
  }
  return {
    measured_at: new Date().toISOString(),
    from,
    to_exclusive: to,
    reports,
    local_queries: {
      dataset_open_ms: openMs,
      queries,
      cache_note:
        'First query on a fresh DuckDB connection; operating-system disk cache is not flushed. Repeat timings share the connection.',
    },
    projection: {
      days: projectDays,
      eligible_fresh_days: fresh.length,
      elapsed_seconds: projected('elapsed_seconds'),
      requests: projected('requests'),
      parquet_bytes: projected('parquet_bytes'),
      note: 'Linear extrapolation of observed fresh days, not a confidence interval. Market volume, wallet activity, API latency, throttling and downloader version can change it. Resumed downloads and days sharing an update wallet queue are excluded. Use the update report to time a complete shared run.',
    },
    disk: {
      available_bytes: fs.bavail * fs.bsize,
      largest_observed_working_bytes: Math.max(
        ...reports.map((r) => r.measured_peak_working_bytes),
      ),
    },
  }
}
