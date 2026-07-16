/**
 * Wallet discovery. Both the positions and trades stages funnel every wallet
 * they see through here, so `polymarket_wallets` is the complete participant
 * list that the activity stage later walks.
 *
 * Two deliberately separate concerns:
 *
 *   upsertWallets()      — identity only (wallet, display name). Idempotent, so
 *                          re-syncing a market can't corrupt anything.
 *   refreshWalletStats() — derives trade_count / markets_count / first_trade_ms
 *                          / last_trade_ms from the trade Parquet files.
 *
 * Counters are DERIVED rather than incremented on the fly: a market's trades are
 * rewritten whole whenever it is re-synced, so any "+= n" bookkeeping would
 * double-count on every retry. Recomputing from the rows is both idempotent and
 * cheap (the wallet index carries it).
 *
 * `activity_status` is never touched here: a wallet that has already been synced
 * must not be reset to `pending` just because it traded again — the activity
 * stage resumes it from its cursor instead.
 */

import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { withDeadlockRetry } from '../db/txRetry.js'
import { DuckDBInstance } from '@duckdb/node-api'
import { listFactFiles } from './storage/paths.js'

export type WalletSighting = {
  wallet: string
  name?: string | null
  pseudonym?: string | null
}

/** Anything that can run a SQL statement — the pooled `db` OR an open `tx`. */
export type SqlExecutor = { execute: (query: SQL) => Promise<unknown> }

const CHUNK = 500

function emptyToNull(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t.slice(0, 100)
}

/** One row per wallet: MySQL rejects a batch that hits the same key twice. */
function dedupeSightings(sightings: WalletSighting[]): WalletSighting[] {
  const unique = new Map<string, WalletSighting>()
  for (const s of sightings) {
    const wallet = s.wallet.toLowerCase()
    const existing = unique.get(wallet)
    unique.set(wallet, {
      wallet,
      name: emptyToNull(s.name) ?? existing?.name ?? null,
      pseudonym: emptyToNull(s.pseudonym) ?? existing?.pseudonym ?? null,
    })
  }
  return [...unique.values()]
}

function walletUpsertChunks(rows: WalletSighting[]): SQL[] {
  const stmts: SQL[] = []
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const values = chunk.map((s) => sql`(${s.wallet}, ${s.name ?? null}, ${s.pseudonym ?? null})`)
    stmts.push(
      sql`INSERT INTO polymarket_wallets (wallet, name, pseudonym)
          VALUES ${sql.join(values, sql`, `)}
          ON DUPLICATE KEY UPDATE
            name = COALESCE(VALUES(name), name),
            pseudonym = COALESCE(VALUES(pseudonym), pseudonym)`,
    )
  }
  return stmts
}

/** Register wallets (and refresh their display names). Safe to call repeatedly. */
export async function upsertWallets(sightings: WalletSighting[]): Promise<void> {
  if (sightings.length === 0) return
  const db = getDb()
  for (const stmt of walletUpsertChunks(dedupeSightings(sightings))) {
    // Deadlock-retried like every other writer here: workers on different
    // markets still collide on this table, because the SAME wallets trade in
    // many markets at once. Missing the retry here failed real markets whose
    // trades had already been written — the wallet upsert is the last step, so
    // a deadlock rolled back nothing but still marked the market failed.
    await withDeadlockRetry(() => db.execute(stmt), '[polymarket-data:wallets]')
  }
}

/**
 * Register wallets on an ALREADY-OPEN transaction, so the caller can make wallet
 * discovery atomic with whatever else it writes (e.g. a market's positions +
 * `done` mark). No own deadlock retry: the caller's transaction is already
 * wrapped in `withDeadlockRetry`, which replays the whole unit — retrying here
 * would be nested and could double-apply the enclosing statements.
 */
export async function upsertWalletsInTx(
  tx: SqlExecutor,
  sightings: WalletSighting[],
): Promise<void> {
  if (sightings.length === 0) return
  for (const stmt of walletUpsertChunks(dedupeSightings(sightings))) {
    await tx.execute(stmt)
  }
}

/**
 * Recompute per-wallet trade aggregates from Parquet with DuckDB.
 *
 * Wallets known only from positions (they never traded) keep zeroed counters —
 * they are still participants and still get their activity synced.
 */
export async function refreshWalletStats(): Promise<void> {
  const db = getDb()
  const files = await listFactFiles('trades')
  await db.execute(
    sql`UPDATE polymarket_wallets
        SET trade_count = 0, markets_count = 0, first_trade_ms = NULL, last_trade_ms = NULL`,
  )
  if (files.length === 0) return

  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  let rows: Array<Record<string, unknown>>
  try {
    const fileList = `[${files.map(quote).join(',')}]`
    const result = await connection.runAndReadAll(
      `SELECT lower(wallet) AS wallet,
              count(*)::INTEGER AS trade_count,
              count(DISTINCT market_id)::INTEGER AS markets_count,
              min(ts_ms)::BIGINT AS first_trade_ms,
              max(ts_ms)::BIGINT AS last_trade_ms
       FROM read_parquet(${fileList}, union_by_name = true)
       GROUP BY lower(wallet)`,
    )
    rows = result.getRowObjectsJS()
  } finally {
    connection.closeSync()
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map(
      (row) =>
        sql`(${String(row.wallet)}, ${Number(row.trade_count)}, ${Number(row.markets_count)},
             ${Number(row.first_trade_ms)}, ${Number(row.last_trade_ms)})`,
    )
    await db.execute(
      sql`INSERT INTO polymarket_wallets
            (wallet, trade_count, markets_count, first_trade_ms, last_trade_ms)
          VALUES ${sql.join(values, sql`, `)}
          ON DUPLICATE KEY UPDATE
            trade_count = VALUES(trade_count),
            markets_count = VALUES(markets_count),
            first_trade_ms = VALUES(first_trade_ms),
            last_trade_ms = VALUES(last_trade_ms)`,
    )
  }
}
