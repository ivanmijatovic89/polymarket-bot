import path from 'node:path'
import { sqlQuote } from '../utils/duckdb.js'
import { dates, parseDate, normalizeMarket } from './catalog.js'
import { summarizeMarket } from './derived.js'
import { feedRow, activityRow, positionRow, type ApiRow } from './types.js'
import {
  assessVolumeEvidence,
  VOLUME_WARNING,
  UNRESOLVED_VOLUME,
  type VolumeEvidence,
} from './volume.js'
import { readJson } from './files.js'
import { checkDigests, type FileDigest } from './integrity.js'
import { loadIndex, TABLES, type DatasetIndex } from './storage.js'
import { claimReader } from './retention.js'
import { datasetFamily } from './family.js'
import { abs, units } from './decimal.js'
import { createResearchDatabase } from './database.js'

interface VerificationDay {
  date: string
  valid: boolean
  errors: string[]
  warnings: string[]
  checks: Record<string, number>
  unresolved_wallet_markets: number
  missing_markets: string[]
}

/** Independent SQL identities validate persisted facts, without network calls. */
export async function verifyDataset(root: string, from: string, to: string) {
  const release = await claimReader(root)
  try {
    return await verifySnapshots(root, await loadIndex(root), from, to)
  } finally {
    release()
  }
}

/** Also validates unpublished generations before an atomic index switch. */
export async function verifySnapshots(root: string, index: DatasetIndex, from: string, to: string) {
  const family = await datasetFamily(root)
  const result: VerificationDay[] = []
  for (const date of dates(from, to)) {
    const snapshot = index.days[date]
    const day: VerificationDay = {
      date,
      valid: false,
      errors: [],
      warnings: [],
      checks: {},
      unresolved_wallet_markets: snapshot?.unresolved_wallet_markets ?? 0,
      missing_markets: snapshot?.missing_markets ?? [],
    }
    result.push(day)
    if (!snapshot) {
      day.errors.push('Day has not been downloaded')
      continue
    }
    const report = await readJson<Record<string, unknown>>(path.join(root, snapshot.report))
    if (!report) {
      day.errors.push('Snapshot report is missing')
      continue
    }
    if (report.files)
      day.errors.push(
        ...(await checkDigests(
          path.join(root, snapshot.directory),
          report.files as Record<string, FileDigest>,
        )),
      )
    else
      day.warnings.push('Legacy snapshot has no file checksums; rebuild locally to establish them')
    if (day.errors.length) continue
    const { connection, close } = await createResearchDatabase()
    try {
      for (const table of TABLES)
        await connection.run(
          `CREATE VIEW ${table} AS SELECT * FROM read_parquet(${sqlQuote(path.join(root, snapshot.directory, `${table}.parquet`))})`,
        )
      const marketColumns = (await connection.runAndReadAll('DESCRIBE markets')).getRowObjectsJson()
      if (!marketColumns.some((row) => row.column_name === 'source_warnings'))
        await connection.run(
          `CREATE OR REPLACE VIEW markets AS SELECT *, []::VARCHAR[] AS source_warnings FROM read_parquet(${sqlQuote(path.join(root, snapshot.directory, 'markets.parquet'))})`,
        )
      const check = async (name: string, sql: string, expected = 0) => {
        const rows = (await connection.runAndReadAll(sql)).getRowObjectsJson()
        const actual = Number(rows[0]?.n)
        day.checks[name] = actual
        if (actual !== expected) day.errors.push(`${name}: expected ${expected}, got ${actual}`)
      }
      await check('scheduled_windows', 'SELECT count(*) AS n FROM coverage', family.windowsPerDay)
      await check(
        'unique_windows',
        'SELECT count(DISTINCT market_start) AS n FROM coverage',
        family.windowsPerDay,
      )
      await check(
        'invalid_window_boundaries',
        `SELECT count(*) AS n FROM coverage WHERE market_start < ${parseDate(date)} OR market_start >= ${parseDate(date) + 86400} OR market_start % ${family.windowSeconds} <> 0`,
      )
      await check(
        'market_rows',
        'SELECT count(*) AS n FROM markets',
        family.windowsPerDay - snapshot.missing_markets.length,
      )
      await check('trade_rows', 'SELECT count(*) AS n FROM trades', Number(report.trade_rows))
      await check(
        'activity_rows',
        'SELECT count(*) AS n FROM activities',
        Number(report.activity_rows),
      )
      await check(
        'position_rows',
        'SELECT count(*) AS n FROM positions',
        Number(report.position_rows),
      )
      await check(
        'duplicate_wallet_markets',
        'SELECT count(*) AS n FROM (SELECT wallet, condition_id FROM wallet_markets GROUP BY ALL HAVING count(*) <> 1)',
      )
      await check(
        'missing_participant_summaries',
        `SELECT count(*) AS n FROM (
        (SELECT DISTINCT lower(proxy_wallet) AS wallet, condition_id FROM trades EXCEPT SELECT wallet, condition_id FROM wallet_markets)
        UNION ALL (SELECT wallet, condition_id FROM wallet_markets EXCEPT SELECT DISTINCT lower(proxy_wallet), condition_id FROM trades))`,
      )
      await check(
        'unknown_market_references',
        `SELECT count(*) AS n FROM (
        SELECT condition_id FROM trades UNION ALL SELECT condition_id FROM activities UNION ALL SELECT condition_id FROM positions UNION ALL SELECT condition_id FROM wallet_markets
        ) facts ANTI JOIN markets USING (condition_id)`,
      )
      await check(
        'cash_identity_failures',
        `SELECT count(*) AS n FROM wallet_markets WHERE cash_pnl_usdc <> sell_usdc + merge_usdc + redeem_usdc - buy_usdc - split_usdc`,
      )
      await check(
        'economic_identity_failures',
        `SELECT count(*) AS n FROM wallet_markets WHERE economic_pnl_usdc <> cash_pnl_usdc + unredeemed_value_usdc OR pnl_with_rewards_usdc <> economic_pnl_usdc + rewards_usdc`,
      )
      await check(
        'activity_cash_failures',
        `WITH cash AS (SELECT lower(proxy_wallet) AS wallet, condition_id,
        sum(CASE WHEN type='TRADE' AND side='BUY' OR type='SPLIT' THEN -usdc_size WHEN type='TRADE' AND side='SELL' OR type IN ('MERGE','REDEEM') THEN usdc_size ELSE 0 END) AS amount
        FROM activities GROUP BY ALL)
        SELECT count(*) AS n FROM wallet_markets w LEFT JOIN cash USING(wallet, condition_id) WHERE w.cash_pnl_usdc <> coalesce(cash.amount, 0)`,
      )
      await check(
        'complete_rows_with_issues',
        `SELECT count(*) AS n FROM wallet_markets WHERE quality = 'complete' AND (len(issues) <> 0 OR economic_pnl_usdc IS NULL OR api_pnl_status NOT IN ('match', 'rounding_compatible', 'fee_basis_difference'))`,
      )
      await check(
        'source_volume_quality_failures',
        `SELECT count(*) AS n FROM wallet_markets w JOIN markets m USING(condition_id)
         WHERE (coalesce(list_contains(m.source_warnings, '${UNRESOLVED_VOLUME}'), false)
           AND (w.quality <> 'unresolved' OR NOT list_contains(w.issues, '${UNRESOLVED_VOLUME}')))
         OR (list_contains(w.issues, '${UNRESOLVED_VOLUME}')
           AND NOT coalesce(list_contains(m.source_warnings, '${UNRESOLVED_VOLUME}'), false))`,
      )
      await check(
        'complete_wallet_markets',
        `SELECT count(*) AS n FROM wallet_markets WHERE quality='complete'`,
        snapshot.complete_wallet_markets,
      )
      await check(
        'unresolved_wallet_markets',
        `SELECT count(*) AS n FROM wallet_markets WHERE quality='unresolved'`,
        snapshot.unresolved_wallet_markets,
      )
      await check(
        'pending_wallet_markets',
        `SELECT count(*) AS n FROM wallet_markets WHERE quality='pending_resolution'`,
        snapshot.pending_wallet_markets,
      )
      await check(
        'coverage_count_failures',
        `WITH totals AS (SELECT condition_id, count(*) AS wallets, sum(trade_count) AS trades,
        count(*) FILTER (WHERE quality='complete') AS complete, count(*) FILTER (WHERE quality='unresolved') AS unresolved,
        count(*) FILTER (WHERE quality='pending_resolution') AS pending FROM wallet_markets GROUP BY condition_id)
        SELECT count(*) AS n FROM coverage c LEFT JOIN totals t USING(condition_id) WHERE c.wallet_count <> coalesce(t.wallets,0) OR c.trade_count <> coalesce(t.trades,0) OR c.complete_wallets <> coalesce(t.complete,0) OR c.unresolved_wallets <> coalesce(t.unresolved,0) OR c.pending_wallets <> coalesce(t.pending,0)`,
      )
      // EXCEPT ALL preserves genuine identical fills. Check only rows that the
      // accounting layer claims are complete; unresolved differences are explicit.
      const fields =
        'lower(proxy_wallet), condition_id, token_id, lower(transaction_hash), timestamp, side, size, round(price,6)'
      await check(
        'complete_trade_multiset_mismatches',
        `WITH t AS (SELECT ${fields.replaceAll('condition_id', 'trades.condition_id')} FROM trades JOIN wallet_markets w ON lower(trades.proxy_wallet)=w.wallet AND trades.condition_id=w.condition_id WHERE w.quality='complete'),
        a AS (SELECT ${fields.replaceAll('condition_id', 'activities.condition_id')} FROM activities JOIN wallet_markets w ON lower(activities.proxy_wallet)=w.wallet AND activities.condition_id=w.condition_id WHERE w.quality='complete' AND type='TRADE')
        SELECT count(*) AS n FROM ((SELECT * FROM t EXCEPT ALL SELECT * FROM a) UNION ALL (SELECT * FROM a EXCEPT ALL SELECT * FROM t))`,
      )
      const downloaded = (
        await connection.runAndReadAll(
          'SELECT m.slug, coalesce(sum(t.size) FILTER (WHERE t.is_taker),0)::VARCHAR AS amount FROM markets m LEFT JOIN trades t USING(condition_id) GROUP BY m.slug',
        )
      ).getRowObjectsJson()
      const volume = report.volume_checks as
        | {
            slug: string
            expected_taker_shares: string
            downloaded_taker_shares: string
            verification: string
          }[]
        | undefined
      let warned = 0
      for (const row of downloaded) {
        const expected = volume?.find((v) => v.slug === row.slug)
        if (!expected) {
          day.errors.push(`Taker volume check missing: ${String(row.slug)}`)
          continue
        }
        const mismatch = abs(units(row.amount) - units(expected.expected_taker_shares)) > 1n
        const flagged = [VOLUME_WARNING, UNRESOLVED_VOLUME].includes(expected.verification)
        if (!mismatch && !flagged) continue
        if (
          !mismatch ||
          !flagged ||
          units(row.amount) !== units(expected.downloaded_taker_shares)
        ) {
          day.errors.push(`Taker volume check failed: ${String(row.slug)}`)
          continue
        }
        if (!(report.files as Record<string, FileDigest> | undefined)?.['volume-evidence.json'])
          throw new Error('Source-volume evidence checksum is missing')
        const evidence = await readJson<Record<string, VolumeEvidence>>(
          path.join(root, snapshot.directory, 'volume-evidence.json'),
        )
        const marketRows = (
          await connection.runAndReadAll(
            `SELECT * FROM markets WHERE slug=${sqlQuote(String(row.slug))}`,
          )
        ).getRowObjectsJson()
        const savedMarket = marketRows[0]!
        const market = normalizeMarket(
          JSON.parse(String(savedMarket.raw_json)) as ApiRow,
          JSON.parse(String(savedMarket.resolution_json)) as ApiRow,
          family.id,
        )
        const raw = async (table: string) =>
          (
            await connection.runAndReadAll(
              `SELECT raw_json FROM ${table} WHERE condition_id=${sqlQuote(market.condition_id)}`,
            )
          )
            .getRowObjectsJson()
            .map((r) => JSON.parse(String(r.raw_json)) as ApiRow)
        const trades = (await raw('trades')).map(feedRow)
        const activities = (await raw('activities')).map(activityRow)
        const positions = (await raw('positions')).map(positionRow)
        const summaries = summarizeMarket(
          market,
          trades,
          activities,
          positions,
          new Set(trades.map((r) => r.proxy_wallet.toLowerCase())),
        )
        if (!evidence?.[market.condition_id])
          throw new Error(`Source-volume evidence missing: ${market.slug}`)
        const assessment = assessVolumeEvidence(
          market,
          trades,
          units(expected.expected_taker_shares),
          evidence[market.condition_id]!,
          summaries,
        )
        if (assessment.code !== expected.verification)
          throw new Error(`Source-volume classification differs from evidence: ${market.slug}`)
        const warning = snapshot.source_warnings?.find(
          (w) =>
            w.slug === market.slug &&
            w.condition_id === market.condition_id &&
            w.code === assessment.code,
        )
        if (
          !warning ||
          units(warning.difference_shares) !== units(assessment.difference) ||
          !(savedMarket.source_warnings as string[] | undefined)?.includes(assessment.code)
        )
          throw new Error(`Source-volume warning missing from market/index: ${market.slug}`)
        warned++
        day.warnings.push(
          `${assessment.code}: ${market.slug}, ${assessment.difference} shares; ${assessment.code === UNRESOLVED_VOLUME ? 'all observed market participants excluded from strict rankings' : 'counterparty accounting reconciles, aggregate remains inconsistent'}`,
        )
      }
      day.checks.source_volume_warnings = warned
      if (warned !== (snapshot.source_warnings?.length ?? 0))
        day.errors.push('Source-volume warning count differs from index')
    } catch (error) {
      day.errors.push(String(error))
    } finally {
      close()
    }
    day.valid = day.errors.length === 0
  }
  return {
    valid: result.every((day) => day.valid),
    all_source_aggregates_reconciled: result.every(
      (day) => day.valid && day.checks.source_volume_warnings === 0,
    ),
    all_wallet_accounting_complete: result.every(
      (day) =>
        day.valid &&
        day.unresolved_wallet_markets === 0 &&
        day.missing_markets.length === 0 &&
        index.days[day.date]?.pending_wallet_markets === 0,
    ),
    definition:
      'Local file integrity and independent fact identities; this does not certify upstream API completeness beyond the saved checks.',
    days: result,
  }
}
