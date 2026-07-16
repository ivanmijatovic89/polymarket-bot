/**
 * Pure argument parsing for the `polymarket-data:verify` CLI, split out of the
 * self-executing verify.ts so the parser — and its validation — is unit-testable.
 */

import { isTimeframe, type Timeframe } from './marketSeries.js'

const LABEL = '[polymarket-data:verify]'

export type Args = {
  symbol?: string
  timeframe?: Timeframe
  slugs?: string[]
  limit: number | null
  resample: number
  walletResample: number
  requeue: boolean
}

/**
 * Parse an integer flag, rejecting missing / non-integer / fractional / below-`min`
 * values instead of silently coercing. `Number(x) || default` accepted all of
 * those (`'abc' → NaN → default`, `'2.5' → 2.5`, `'-1' → -1`), so a typo quietly
 * changed the run — e.g. `--limit 0` or `--limit -5` fell back to "no limit".
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
  const out: Args = { limit: null, resample: 0, walletResample: 3, requeue: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--symbol') out.symbol = (argv[++i] ?? '').toLowerCase()
    else if (a === '--timeframe') {
      const tf = argv[++i] ?? ''
      if (!isTimeframe(tf)) throw new Error(`${LABEL} unknown --timeframe: ${tf}`)
      out.timeframe = tf
    } else if (a === '--slug') {
      out.slugs = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    } else if (a === '--limit') out.limit = parseIntArg(argv[++i], a, { min: 1 })
    // Preserve 0: `--resample 0` means "invariant only, no live re-sampling".
    else if (a === '--resample') out.resample = parseIntArg(argv[++i], a, { min: 0 })
    else if (a === '--wallet-resample') out.walletResample = parseIntArg(argv[++i], a, { min: 0 })
    else if (a === '--requeue') out.requeue = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}
