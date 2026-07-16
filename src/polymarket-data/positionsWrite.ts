/**
 * The small MySQL half of a positions write. Position facts are written to an
 * atomic Parquet file before this transaction runs; MySQL only registers the
 * participant wallets and records the completed sync state.
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
 * Register the wallets represented by the already-published Parquet snapshot,
 * then mark the market done in the same MySQL transaction.
 */
export async function writePositionsTx(
  tx: SqlExecutor,
  marketId: number,
  rows: ApiPosition[],
): Promise<void> {
  // Wallets are registered before the done-mark, so a completed market always
  // has a discoverable participant set.
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
