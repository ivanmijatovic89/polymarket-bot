import { DuckDBInstance } from '@duckdb/node-api'
import path from 'node:path'
import { sqlQuote } from '../utils/duckdb.js'
import { dates, parseDate } from './catalog.js'
import { readJson } from './files.js'
import { checkDigests, type FileDigest } from './integrity.js'
import { loadIndex, TABLES } from './storage.js'
import { abs, units } from './decimal.js'

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
  const index = await loadIndex(root)
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
    const db = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '512MB' })
    const connection = await db.connect()
    try {
      for (const table of TABLES)
        await connection.run(
          `CREATE VIEW ${table} AS SELECT * FROM read_parquet(${sqlQuote(path.join(root, snapshot.directory, `${table}.parquet`))})`,
        )
      const check = async (name: string, sql: string, expected = 0) => {
        const rows = (await connection.runAndReadAll(sql)).getRowObjectsJson()
        const actual = Number(rows[0]?.n)
        day.checks[name] = actual
        if (actual !== expected) day.errors.push(`${name}: expected ${expected}, got ${actual}`)
      }
      await check('scheduled_windows', 'SELECT count(*) AS n FROM coverage', 96)
      await check('unique_windows', 'SELECT count(DISTINCT market_start) AS n FROM coverage', 96)
      await check(
        'invalid_window_boundaries',
        `SELECT count(*) AS n FROM coverage WHERE market_start < ${parseDate(date)} OR market_start >= ${parseDate(date) + 86400} OR market_start % 900 <> 0`,
      )
      await check(
        'market_rows',
        'SELECT count(*) AS n FROM markets',
        96 - snapshot.missing_markets.length,
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
        `SELECT count(*) AS n FROM wallet_markets WHERE quality = 'complete' AND (len(issues) <> 0 OR economic_pnl_usdc IS NULL OR api_pnl_status NOT IN ('match', 'rounding_compatible'))`,
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
        | { slug: string; expected_taker_shares: string }[]
        | undefined
      for (const row of downloaded) {
        const expected = volume?.find((v) => v.slug === row.slug)
        if (!expected || abs(units(row.amount) - units(expected.expected_taker_shares)) > 1n)
          day.errors.push(`Taker volume check failed: ${String(row.slug)}`)
      }
    } catch (error) {
      day.errors.push(String(error))
    } finally {
      connection.closeSync()
      db.closeSync()
    }
    day.valid = day.errors.length === 0
  }
  return {
    valid: result.every((day) => day.valid),
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
