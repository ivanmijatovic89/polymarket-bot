/**
 * Pass/fail verdict for one resampled market: stored data vs a fresh pull from
 * the live API. Pure so it can be unit-tested without the DB or network (verify
 * self-executes on import).
 *
 * Backed by two independent live pulls:
 *   - `/trades` (capped for busy markets → a LOWER bound): our stored rows must
 *     be >= what the live query can page.
 *   - `/v1/market-positions` (complete, NOT capped): the participant list is the
 *     ground truth. We compare IDENTITIES, not just counts — equal counts do not
 *     prove equal sets (stored could hold a stale participant B while live has a
 *     new/missing participant A). A live position absent from stored means a
 *     missing participant, and this is the ONLY signal that catches a wallet
 *     absent from BOTH our stored positions AND our capped stored trades (the
 *     orphan-wallet check can't see that wallet at all).
 */
export type PositionKey = { wallet: string; asset: string }

export type ResampleInputs = {
  storedRows: number
  liveRows: number
  storedPositions: PositionKey[]
  livePositions: PositionKey[]
  /** Trade wallets with no stored positions row (a superset violation). */
  orphanWallets: number
}

export type ResampleVerdict = { ok: boolean; notes: string[] }

/** `(wallet, asset)` identity, wallet lowercased so casing differences don't hide a real mismatch. */
function positionKey(p: PositionKey): string {
  return `${p.wallet.toLowerCase()}|${p.asset}`
}

export function resampleVerdict(x: ResampleInputs): ResampleVerdict {
  const notes: string[] = []

  // live /trades is a lower bound (capped); stored must never be below it.
  if (x.storedRows < x.liveRows) {
    notes.push(`stored_rows ${x.storedRows} < live_rows ${x.liveRows} (missing trades)`)
  }

  const stored = new Set(x.storedPositions.map(positionKey))
  const live = new Set(x.livePositions.map(positionKey))

  // Live positions absent from stored = missing participants. This is the real
  // failure: deep-backfill would never discover these wallets. Comparing
  // identities (not totals) catches the equal-count-but-different-set case.
  const missing = [...live].filter((k) => !stored.has(k))
  if (missing.length > 0) {
    notes.push(
      `${missing.length} live position(s) missing from stored (e.g. ${missing.slice(0, 3).join(', ')})`,
    )
  }

  // Stored positions absent from live are NON-fatal: a wallet can redeem to zero
  // and drop out of the live snapshot after we synced. Informational only.
  const storedOnly = [...stored].filter((k) => !live.has(k))
  if (storedOnly.length > 0) {
    notes.push(
      `note: ${storedOnly.length} stored position(s) not in live snapshot (positions changed since sync)`,
    )
  }

  if (x.orphanWallets > 0) {
    notes.push(`${x.orphanWallets} trade-wallets missing from positions`)
  }

  // "note:" lines are informational, not failures.
  const failing = notes.filter((n) => !n.startsWith('note:'))
  return { ok: failing.length === 0, notes }
}
