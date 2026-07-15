/**
 * Pure argument parsing for `sync-activity`, split out of the self-executing
 * `sync-activity.ts` so the parser — and its validation — is unit-testable.
 */

const LABEL = '[polymarket-data:sync-activity]'

export type Args = {
  wallets?: string[]
  limit: number | null
  minTrades: number
  concurrency: number
  full: boolean
  retryFailed: boolean
  refreshDone: boolean
  staleAfterHours: number | null
  resetProcessing: boolean
  dryRun: boolean
}

/**
 * Parse an integer flag, rejecting missing / non-integer / fractional / below-`min`
 * values instead of silently applying a default. `Number(x) || default` accepted
 * all of those (`'abc' → NaN → default`, `'2.5' → 2.5`, `'-1' → -1`), so a typo
 * quietly changed the run's behaviour rather than failing.
 */
export function parseIntArg(raw: string | undefined, flag: string, opts: { min: number }): number {
  const n = Number(raw)
  if (raw === undefined || raw.trim() === '' || !Number.isInteger(n) || n < opts.min) {
    throw new Error(
      `${LABEL} ${flag} requires an integer >= ${opts.min}, got: ${raw ?? '(missing)'}`,
    )
  }
  return n
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    limit: null,
    minTrades: 0,
    concurrency: 4,
    full: false,
    retryFailed: false,
    refreshDone: false,
    staleAfterHours: null,
    resetProcessing: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--wallet') {
      out.wallets = (argv[++i] ?? '')
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w !== '')
    } else if (a === '--limit') {
      // Preserve 0: `--limit 0` means "do the re-queue admin, sync nothing".
      out.limit = parseIntArg(argv[++i], a, { min: 0 })
    } else if (a === '--min-trades') out.minTrades = parseIntArg(argv[++i], a, { min: 0 })
    else if (a === '--concurrency') out.concurrency = parseIntArg(argv[++i], a, { min: 1 })
    else if (a === '--full') out.full = true
    else if (a === '--retry-failed') out.retryFailed = true
    else if (a === '--refresh-done') out.refreshDone = true
    else if (a === '--stale-after') {
      const h = Number(argv[++i] ?? '')
      if (!Number.isFinite(h) || h < 0) throw new Error(`${LABEL} --stale-after needs hours >= 0`)
      out.staleAfterHours = h
    } else if (a === '--reset-processing') out.resetProcessing = true
    else if (a === '--dry-run') out.dryRun = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}
