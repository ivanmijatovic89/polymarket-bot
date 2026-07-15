/**
 * Pass/fail verdict for one resampled market: stored data vs a fresh pull from
 * the live API. Pure so it can be unit-tested without the DB or network (verify
 * self-executes on import).
 *
 * Two independent live pulls back the check:
 *   - `/trades` (capped for busy markets → a LOWER bound): our stored rows must
 *     be >= what the live query can page.
 *   - `/v1/market-positions` (complete, NOT capped): the participant list is the
 *     ground truth. Our stored positions should MATCH it. A stored count BELOW
 *     live means we are missing participants — and this is the only signal that
 *     catches a participant absent from BOTH our stored positions AND our capped
 *     stored trades (the orphan-wallet check can't see that wallet at all).
 */
export type ResampleInputs = {
  storedRows: number
  liveRows: number
  storedPositions: number
  livePositions: number
  /** Trade wallets with no stored positions row (a superset violation). */
  orphanWallets: number
}

export type ResampleVerdict = { ok: boolean; notes: string[] }

export function resampleVerdict(x: ResampleInputs): ResampleVerdict {
  const notes: string[] = []

  // live /trades is a lower bound (capped); stored must never be below it.
  if (x.storedRows < x.liveRows) {
    notes.push(`stored_rows ${x.storedRows} < live_rows ${x.liveRows} (missing trades)`)
  }

  // live positions is complete. Stored BELOW live = missing participants (a real
  // gap, and the failure this check exists for). Stored ABOVE live is treated as
  // a non-fatal note: positions can legitimately shrink after sync (e.g. a wallet
  // redeems to zero and drops out of the live snapshot), which is not a data loss.
  if (x.storedPositions < x.livePositions) {
    notes.push(
      `stored_positions ${x.storedPositions} < live_positions ${x.livePositions} (missing participants)`,
    )
  } else if (x.storedPositions > x.livePositions) {
    notes.push(
      `note: stored_positions ${x.storedPositions} > live_positions ${x.livePositions} (positions changed since sync)`,
    )
  }

  if (x.orphanWallets > 0) {
    notes.push(`${x.orphanWallets} trade-wallets missing from positions`)
  }

  // The "positions changed since sync" note is informational, not a failure.
  const failing = notes.filter((n) => !n.startsWith('note:'))
  return { ok: failing.length === 0, notes }
}
