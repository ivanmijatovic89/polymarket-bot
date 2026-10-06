import { sqlQuote } from '../utils/duckdb.js'
import { dates, parseDate } from './catalog.js'
import { openDataset, type DatasetIndex } from './storage.js'
import { datasetFamily } from './family.js'

export async function querySql(root: string, sql: string): Promise<unknown[]> {
  const { connection, close } = await openDataset(root)
  try {
    return (await connection.runAndReadAll(sql)).getRowObjectsJson()
  } finally {
    close()
  }
}

function requireCoverage(index: DatasetIndex, from: string, to: string) {
  const required = dates(from, to)
  const missingDays = required.filter((day) => !index.days[day])
  const missingMarkets = required.flatMap((day) => index.days[day]?.missing_markets ?? [])
  if (missingDays.length || missingMarkets.length)
    throw new Error(
      `Requested range is not fully downloaded. Missing days: ${missingDays.join(', ') || 'none'}; missing market windows: ${missingMarkets.length}. Run research:update or inspect research:coverage.`,
    )
}

/** Normal research includes every observed wallet and every selected market row. */
export async function leaderboard(
  root: string,
  from: string,
  to: string,
  limit = 100,
): Promise<unknown> {
  const { connection, index, close } = await openDataset(root)
  try {
    requireCoverage(index, from, to)
    const family = await datasetFamily(root)
    const rows = (
      await connection.runAndReadAll(`SELECT wallet,
      CASE WHEN count(*) FILTER (WHERE economic_pnl_usdc IS NULL) = 0
        THEN sum(economic_pnl_usdc) END AS profit_usdc,
      count(*) AS markets, sum(trade_count) AS trades
      FROM wallet_markets WHERE market_start >= ${parseDate(from)} AND market_start < ${parseDate(to)}
      GROUP BY wallet ORDER BY profit_usdc DESC NULLS LAST, wallet
      LIMIT ${Math.max(1, Math.min(10000, Math.floor(limit)))}`)
    ).getRowObjectsJson()
    return { market: family.id, from, to_exclusive: to, rows }
  } finally {
    close()
  }
}

export async function strictLeaderboard(
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
      market: (await datasetFamily(root)).id,
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
  audit = false,
): Promise<unknown> {
  if (!/^0x[a-f\d]{40}$/i.test(wallet)) throw new Error('Expected a wallet address')
  const address = sqlQuote(wallet.toLowerCase())
  const range = `market_start >= ${parseDate(from)} AND market_start < ${parseDate(to)}`
  const { connection, index, close } = await openDataset(root)
  try {
    requireCoverage(index, from, to)
    const columns = audit
      ? '*'
      : '* EXCLUDE(quality, issues, notes, api_pnl_status, api_position_pnl_usdc, api_pnl_difference_usdc, modeled_api_pnl_usdc)'
    const markets = (
      await connection.runAndReadAll(
        `SELECT ${columns} FROM wallet_markets WHERE wallet = ${address} AND ${range} ORDER BY market_start`,
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
      ...(audit
        ? {
            source_warnings: dates(from, to).flatMap(
              (day) => index.days[day]?.source_warnings ?? [],
            ),
          }
        : {}),
      from,
      to_exclusive: to,
      markets,
      activity_limit: limit,
      activities,
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
      expected_windows: required.length * (await datasetFamily(root)).windowsPerDay,
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
