import { sqlQuote } from '../utils/duckdb.js'
import { dates, parseDate } from './catalog.js'
import { openDataset } from './storage.js'

export async function querySql(root: string, sql: string): Promise<unknown[]> {
  const { connection, close } = await openDataset(root)
  try {
    return (await connection.runAndReadAll(sql)).getRowObjectsJson()
  } finally {
    close()
  }
}

export async function leaderboard(
  root: string,
  from: string,
  to: string,
  limit = 100,
): Promise<unknown> {
  const { connection, index, close } = await openDataset(root)
  try {
    const required = dates(from, to)
    const missingDays = required.filter((day) => !index.days[day])
    const missingMarkets = required.flatMap((day) => index.days[day]?.missing_markets ?? [])
    if (missingDays.length || missingMarkets.length) {
      throw new Error(
        `Strict leaderboard needs complete market coverage. Missing days: ${missingDays.join(', ') || 'none'}; missing market windows: ${missingMarkets.length}. Use coverage or SQL to inspect partial data.`,
      )
    }
    const range = `market_start >= ${parseDate(from)} AND market_start < ${parseDate(to)}`
    const totals = (
      await connection.runAndReadAll(`SELECT count(DISTINCT wallet) AS wallets,
      count(DISTINCT wallet) FILTER (WHERE quality <> 'complete') AS excluded_wallets,
      count(*) FILTER (WHERE quality <> 'complete') AS unresolved_wallet_markets
      FROM wallet_markets WHERE ${range}`)
    ).getRowObjectsJson()
    const rows = (
      await connection.runAndReadAll(`WITH ranked AS (
      SELECT wallet, count(*) AS markets, sum(trade_count) AS trades,
        sum(economic_pnl_usdc) AS economic_pnl_usdc, sum(cash_pnl_usdc) AS cash_pnl_usdc,
        sum(unredeemed_value_usdc) AS unredeemed_value_usdc, sum(rewards_usdc) AS rewards_usdc,
        sum(pnl_with_rewards_usdc) AS pnl_with_rewards_usdc,
        count(*) FILTER (WHERE economic_pnl_usdc > 0) AS profitable_markets,
        count(*) FILTER (WHERE quality <> 'complete') AS incomplete_markets,
        count(*) FILTER (WHERE api_pnl_status = 'rounding_compatible') AS api_rounding_differences,
        count(*) FILTER (WHERE api_pnl_status = 'fee_basis_difference') AS api_fee_basis_differences
      FROM wallet_markets WHERE ${range} GROUP BY wallet)
      SELECT * EXCLUDE (incomplete_markets) FROM ranked WHERE incomplete_markets = 0
      ORDER BY economic_pnl_usdc DESC, wallet LIMIT ${Math.max(1, Math.min(10000, Math.floor(limit)))}`)
    ).getRowObjectsJson()
    return {
      market: 'btc:15m',
      source_warnings: required.flatMap((day) => index.days[day]?.source_warnings ?? []),
      from,
      to_exclusive: to,
      definition:
        'Selected market lifecycles; net trade fees; settlement-valued holdings; rewards separate',
      snapshots: required.map((day) => ({ date: day, as_of: index.days[day]!.as_of })),
      coverage: totals[0],
      rows,
    }
  } finally {
    close()
  }
}

export async function walletReport(
  root: string,
  wallet: string,
  from: string,
  to: string,
  limit = 200,
): Promise<unknown> {
  if (!/^0x[a-f\d]{40}$/i.test(wallet)) throw new Error('Expected a wallet address')
  const address = sqlQuote(wallet.toLowerCase())
  const range = `market_start >= ${parseDate(from)} AND market_start < ${parseDate(to)}`
  const { connection, index, close } = await openDataset(root)
  try {
    const markets = (
      await connection.runAndReadAll(
        `SELECT * FROM wallet_markets WHERE wallet = ${address} AND ${range} ORDER BY market_start`,
      )
    ).getRowObjectsJson()
    const activities = (
      await connection.runAndReadAll(`SELECT a.* EXCLUDE(raw_json), m.slug
      FROM activities a JOIN markets m USING(condition_id)
      WHERE a.proxy_wallet = ${address} AND ${range}
      ORDER BY timestamp, row_index LIMIT ${Math.max(1, Math.min(10000, Math.floor(limit)))}`)
    ).getRowObjectsJson()
    return {
      wallet: wallet.toLowerCase(),
      source_warnings: dates(from, to).flatMap((day) => index.days[day]?.source_warnings ?? []),
      from,
      to_exclusive: to,
      missing_days: dates(from, to).filter((day) => !index.days[day]),
      markets,
      activity_limit: limit,
      activities,
      ordering_note: 'Timestamp and source row order; not an exact matching-engine timeline.',
    }
  } finally {
    close()
  }
}

export async function coverageReport(root: string, from: string, to: string): Promise<unknown> {
  const { connection, index, close } = await openDataset(root)
  try {
    const required = dates(from, to)
    const range = `market_start >= ${parseDate(from)} AND market_start < ${parseDate(to)}`
    const windows = (
      await connection.runAndReadAll(`SELECT count(*) AS cataloged_windows,
      count(*) FILTER (WHERE found) AS found_windows, sum(trade_count) AS trade_rows,
      sum(wallet_count) AS wallet_markets, sum(complete_wallets) AS complete_wallet_markets,
      sum(unresolved_wallets) AS unresolved_wallet_markets, sum(pending_wallets) AS pending_wallet_markets
      FROM coverage WHERE ${range}`)
    ).getRowObjectsJson()
    const issues = (
      await connection.runAndReadAll(
        `SELECT u.issue, count(*) AS wallet_markets FROM wallet_markets, unnest(issues) AS u(issue) WHERE ${range} GROUP BY u.issue ORDER BY wallet_markets DESC`,
      )
    ).getRowObjectsJson()
    return {
      from,
      to_exclusive: to,
      expected_windows: required.length * 96,
      source_warnings: required.flatMap((day) => index.days[day]?.source_warnings ?? []),
      missing_days: required.filter((day) => !index.days[day]),
      windows: windows[0],
      issues,
      days: required.map((day) => index.days[day] ?? { date: day, status: 'missing' }),
    }
  } finally {
    close()
  }
}
