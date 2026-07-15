/**
 * The per-market positions write, extracted so its transactional shape is
 * unit-testable without a DB.
 *
 * The whole unit runs on ONE executor (`tx`): replace the position rows,
 * register the participant wallets, and only THEN mark the market `done`.
 * Registering wallets inside the transaction — not in a separate call after it
 * commits — is what makes participant discovery crash-consistent: a kill between
 * the commit and a separate wallet upsert used to leave positions stored and
 * `done` but their wallets absent from `polymarket_wallets`, so later runs
 * skipped the done market and `sync-activity` never visited those participants.
 */

import { sql } from 'drizzle-orm'
import type { ApiPosition } from './dataApi.js'
import { upsertWalletsInTx, type SqlExecutor } from './walletUpsert.js'

const INSERT_CHUNK = 500

function dec(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6) : null
}

/**
 * One row per (wallet, asset): a wallet can hold both outcomes, but the API must
 * not hand us the same pair twice.
 */
export function dedupePositions(positions: ApiPosition[]): ApiPosition[] {
  const unique = new Map<string, ApiPosition>()
  for (const p of positions) {
    unique.set(`${p.proxyWallet.toLowerCase()}|${p.asset}`, p)
  }
  return [...unique.values()]
}

/**
 * Write a market's positions, register its wallets, and mark it done — all on
 * `tx`, in this order, as a single atomic unit. Takes only `tx`, so there is no
 * way to write outside the transaction.
 */
export async function writePositionsTx(
  tx: SqlExecutor,
  marketId: number,
  rows: ApiPosition[],
): Promise<void> {
  await tx.execute(sql`DELETE FROM polymarket_market_positions WHERE market_id = ${marketId}`)

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const values = chunk.map(
      (p) =>
        sql`(${marketId}, ${p.proxyWallet.toLowerCase()}, ${p.asset}, ${p.outcomeIndex ?? null},
         ${dec(p.size)}, ${dec(p.avgPrice)}, ${dec(p.totalBought)}, ${dec(p.realizedPnl)}, ${dec(p.cashPnl)})`,
    )
    await tx.execute(
      sql`INSERT INTO polymarket_market_positions
        (market_id, wallet, asset, outcome_index, final_size, avg_price, total_bought, realized_pnl, cash_pnl)
      VALUES ${sql.join(values, sql`, `)}`,
    )
  }

  // Wallets are registered BEFORE the done-mark and in the SAME transaction: the
  // market cannot be marked done unless its participants committed with it.
  await upsertWalletsInTx(
    tx,
    rows.map((p) => ({
      wallet: p.proxyWallet,
      name: p.name ?? null,
      pseudonym: p.pseudonym ?? null,
    })),
  )

  await tx.execute(
    sql`UPDATE polymarket_markets
        SET positions_status = 'done',
            positions_synced_at = CURRENT_TIMESTAMP,
            position_rows = ${rows.length},
            positions_error = NULL
        WHERE id = ${marketId}`,
  )
}
