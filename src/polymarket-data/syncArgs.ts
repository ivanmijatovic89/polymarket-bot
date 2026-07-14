/**
 * Argv parsing shared by the market-queue stages (positions, trades). Both take
 * the same selection flags; only the retry flags differ.
 */

import { isTimeframe, type Timeframe } from './marketSeries.js'

export type SyncArgs = {
  symbol?: string
  timeframe?: Timeframe
  slugs?: string[]
  limit: number | null
  latest: boolean
  concurrency: number
  dryRun: boolean
  retryFailed: boolean
  retryPartial: boolean
  resetProcessing: boolean
}

export function parseSyncArgs(argv: string[], label: string): SyncArgs {
  const out: SyncArgs = {
    limit: null,
    latest: false,
    concurrency: 4,
    dryRun: false,
    retryFailed: false,
    retryPartial: false,
    resetProcessing: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--symbol') out.symbol = (argv[++i] ?? '').toLowerCase()
    else if (a === '--timeframe') {
      const tf = argv[++i] ?? ''
      if (!isTimeframe(tf)) throw new Error(`${label} unknown --timeframe: ${tf}`)
      out.timeframe = tf
    } else if (a === '--slug') {
      const raw = argv[++i] ?? ''
      const slugs = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      if (slugs.length === 0) throw new Error(`${label} --slug requires at least one slug`)
      out.slugs = slugs
    } else if (a === '--limit') {
      const n = Number(argv[++i] ?? '')
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${label} --limit must be > 0`)
      out.limit = n
    } else if (a === '--concurrency') {
      const n = Number(argv[++i] ?? '')
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${label} --concurrency must be > 0`)
      out.concurrency = n
    } else if (a === '--latest') out.latest = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--retry-failed') out.retryFailed = true
    else if (a === '--retry-partial') out.retryPartial = true
    else if (a === '--reset-processing') out.resetProcessing = true
    else throw new Error(`${label} unknown arg: ${a}`)
  }

  return out
}

export function queueFilterOf(args: SyncArgs) {
  return {
    ...(args.symbol ? { symbol: args.symbol } : {}),
    ...(args.timeframe ? { timeframe: args.timeframe } : {}),
    ...(args.slugs ? { slugs: args.slugs } : {}),
    ...(args.latest ? { latest: true } : {}),
  }
}
