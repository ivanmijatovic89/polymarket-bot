import { completenessToleranceShares } from './tradeRows.js'

export type ExpectedMarketSnapshot = {
  rows: number
  wallets: number
  sharesVolume: number
  /** Whether the fetched API snapshot already passed the Gamma invariant. */
  complete: boolean | null
  volumeGamma: number | null
}

export type PersistedMarketSnapshot = {
  tradeRows: number
  tradeWallets: number
  sharesVolume: number
  orphanWallets: number
}

/**
 * Verify the just-published Parquet snapshot against the API rows held in
 * memory. This deliberately performs no network calls: a second fetch would
 * double rate-limit cost and could observe a moving upstream snapshot. Gamma
 * is checked again from the catalog value captured with the market claim.
 */
export function marketSnapshotErrors(
  expected: ExpectedMarketSnapshot,
  persisted: PersistedMarketSnapshot,
): string[] {
  const errors: string[] = []
  if (persisted.tradeRows !== expected.rows) {
    errors.push(`persisted rows=${persisted.tradeRows}, API rows=${expected.rows}`)
  }
  if (persisted.tradeWallets !== expected.wallets) {
    errors.push(`persisted wallets=${persisted.tradeWallets}, API wallets=${expected.wallets}`)
  }
  if (persisted.orphanWallets !== 0) {
    errors.push(`${persisted.orphanWallets} trade wallet(s) missing from market positions`)
  }

  const tolerance = completenessToleranceShares(expected.rows)
  const writeDrift = Math.abs(persisted.sharesVolume - expected.sharesVolume)
  if (writeDrift > tolerance) {
    errors.push(
      `persisted shares/2=${persisted.sharesVolume.toFixed(6)}, ` +
        `API shares/2=${expected.sharesVolume.toFixed(6)} (drift ${writeDrift.toFixed(6)})`,
    )
  }

  if (expected.complete === true && expected.volumeGamma !== null) {
    const gammaDrift = Math.abs(persisted.sharesVolume - expected.volumeGamma)
    if (gammaDrift > tolerance) {
      errors.push(
        `persisted shares/2=${persisted.sharesVolume.toFixed(6)}, ` +
          `Gamma=${expected.volumeGamma.toFixed(6)} (drift ${gammaDrift.toFixed(6)})`,
      )
    }
  }
  return errors
}

export function assertMarketSnapshot(
  slug: string,
  expected: ExpectedMarketSnapshot,
  persisted: PersistedMarketSnapshot,
): void {
  const errors = marketSnapshotErrors(expected, persisted)
  if (errors.length > 0) {
    throw new Error(`post-write verification failed for ${slug}: ${errors.join('; ')}`)
  }
}
