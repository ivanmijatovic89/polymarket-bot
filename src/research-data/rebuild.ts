import type { DuckDBConnection } from '@duckdb/node-api'
import { randomUUID } from 'node:crypto'
import { link, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { sqlQuote } from '../utils/duckdb.js'
import { dates, normalizeMarket } from './catalog.js'
import { ACCOUNTING_VERSION, coverageRow, summarizeMarket } from './derived.js'
import { readJson, writeJson } from './files.js'
import { checkDigests, snapshotDigests, type FileDigest } from './integrity.js'
import { loadIndex, publish, TABLES, writeParquet, type DaySnapshot } from './storage.js'
import { claimLock, ensureDisk } from './sync.js'
import { activityRow, feedRow, positionRow, type ApiRow, type WalletMarket } from './types.js'
import { createResearchDatabase } from './database.js'

async function rawRows(
  connection: DuckDBConnection,
  file: string,
  condition: string,
): Promise<ApiRow[]> {
  const result = await connection.runAndReadAll(
    `SELECT raw_json FROM read_parquet(${sqlQuote(file)}) WHERE condition_id = ${sqlQuote(condition)}`,
  )
  return result.getRowObjectsJson().map((row) => JSON.parse(String(row.raw_json)) as ApiRow)
}

/** Recompute derived facts locally; source facts and their original as-of remain immutable. */
export async function rebuildDataset(
  root: string,
  from: string,
  to: string,
  minFreeGiB = 5,
): Promise<DaySnapshot[]> {
  const required = dates(from, to)
  const release = await claimLock(root)
  try {
    const index = await loadIndex(root)
    const missing = required.filter((date) => !index.days[date])
    if (missing.length) throw new Error(`Cannot rebuild missing days: ${missing.join(', ')}`)
    const output: DaySnapshot[] = []
    for (const date of required) {
      await ensureDisk(root, minFreeGiB)
      const previous = index.days[date]!
      const source = path.join(root, previous.directory)
      const previousReport = await readJson<Record<string, unknown>>(
        path.join(root, previous.report),
      )
      if (!previousReport) throw new Error(`Missing source report: ${previous.report}`)
      if (previousReport.files) {
        const errors = await checkDigests(
          source,
          previousReport.files as Record<string, FileDigest>,
        )
        if (errors.length) throw new Error(`Source integrity failed: ${errors.join('; ')}`)
      }
      const jobs = await readJson<{ wallet: string; conditions: string[] }[]>(
        path.join(source, 'wallet-queries.json'),
      )
      if (!jobs) throw new Error('Cannot rebuild without wallet query provenance')
      const generation = randomUUID()
      const directory = path.join('snapshots', date, generation)
      const destination = path.join(root, directory)
      await mkdir(destination, { recursive: true })
      const { connection, close } = await createResearchDatabase()
      const summaries: WalletMarket[] = []
      const coverage: ReturnType<typeof coverageRow>[] = []
      try {
        const marketRows = (
          await connection.runAndReadAll(
            `SELECT * FROM read_parquet(${sqlQuote(path.join(source, 'markets.parquet'))}) ORDER BY market_start`,
          )
        ).getRowObjectsJson()
        for (const row of marketRows) {
          const market = normalizeMarket(
            JSON.parse(String(row.raw_json)) as ApiRow,
            JSON.parse(String(row.resolution_json)) as ApiRow | undefined,
          )
          market.source_warnings = (row.source_warnings as string[] | null) ?? []
          // At most one market's raw history is loaded at a time.
          const trades = (
            await rawRows(connection, path.join(source, 'trades.parquet'), market.condition_id)
          ).map(feedRow)
          const activities = (
            await rawRows(connection, path.join(source, 'activities.parquet'), market.condition_id)
          ).map(activityRow)
          const positions = (
            await rawRows(connection, path.join(source, 'positions.parquet'), market.condition_id)
          ).map(positionRow)
          const fetchedWallets = new Set(
            jobs
              .filter((job) => job.conditions.includes(market.condition_id))
              .map((job) => job.wallet),
          )
          const rows = summarizeMarket(market, trades, activities, positions, fetchedWallets)
          summaries.push(...rows)
          coverage.push(coverageRow(market.slug, market, rows))
        }
        for (const slug of previous.missing_markets) coverage.push(coverageRow(slug, undefined, []))
        coverage.sort((a, b) => a.market_start - b.market_start)
        await writeParquet(connection, 'wallet_markets', summaries, destination)
        await writeParquet(connection, 'coverage', coverage, destination)
        for (const file of [
          'markets.parquet',
          'trades.parquet',
          'activities.parquet',
          'positions.parquet',
          'wallet-queries.json',
          ...((previousReport.files as Record<string, unknown> | undefined)?.[
            'volume-evidence.json'
          ]
            ? ['volume-evidence.json']
            : []),
        ]) {
          // Same filesystem, immutable files: hard links do not duplicate the data.
          await link(path.join(source, file), path.join(destination, file))
        }
      } finally {
        close()
      }
      let bytes = 0
      for (const table of TABLES)
        bytes += (await stat(path.join(destination, `${table}.parquet`))).size
      const snapshot: DaySnapshot = {
        ...previous,
        generation,
        directory,
        report: path.join(directory, 'report.json'),
        parquet_bytes: bytes,
        complete_wallet_markets: summaries.filter((row) => row.quality === 'complete').length,
        unresolved_wallet_markets: summaries.filter((row) => row.quality === 'unresolved').length,
        pending_wallet_markets: summaries.filter((row) => row.quality === 'pending_resolution')
          .length,
      }
      const issues: Record<string, number> = {}
      for (const row of summaries)
        for (const issue of row.issues) issues[issue] = (issues[issue] ?? 0) + 1
      await writeJson(path.join(root, snapshot.report), {
        ...previousReport,
        ...snapshot,
        issues,
        accounting_version: ACCOUNTING_VERSION,
        rebuilt_at: new Date().toISOString(),
        rebuilt_from_generation: previous.generation,
        files: await snapshotDigests(
          destination,
          Boolean(
            (previousReport.files as Record<string, unknown> | undefined)?.['volume-evidence.json'],
          ),
        ),
      })
      await publish(root, snapshot)
      output.push(snapshot)
    }
    return output
  } finally {
    await release()
  }
}
