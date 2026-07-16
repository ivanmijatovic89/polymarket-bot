/**
 * Pure argument parsing and step planning for the `polymarket-data:sync`
 * wrapper. Kept separate from `sync.ts` (which self-executes and does I/O) so the
 * parser and plan are unit-testable.
 */

import { isTimeframe, SYMBOLS, type Timeframe } from './marketSeries.js'

export const LABEL = '[polymarket-data:sync]'

export const STAGE_KEYS = [
  'markets',
  'positions',
  'trades',
  'backfill',
  'activity',
  'verify',
  'catalog',
] as const
export type StageKey = (typeof STAGE_KEYS)[number]

export type Args = {
  symbols: string[] | null
  timeframes: Timeframe[] | null
  from?: string
  to?: string
  full: boolean
  concurrency: number
  walletConcurrency: number
  staleAfterHours: number
  resample: number
  skip: Set<StageKey>
  dryRun: boolean
}

export type Step = { stage: StageKey; script: string; args: string[] }

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '')
}

/**
 * Parse an integer flag, PRESERVING a valid `0` (`Number(x) || default` silently
 * rewrites it — `--stale-after 0` and `--resample 0` are both meaningful). Rejects
 * missing / non-integer / below-`min` values instead of falling back to a default.
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
    symbols: null,
    timeframes: null,
    full: false,
    concurrency: 6,
    walletConcurrency: 16,
    staleAfterHours: 120,
    resample: 10,
    skip: new Set(),
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--symbol') {
      const list = parseList(argv[++i] ?? '')
      for (const s of list)
        if (!SYMBOLS.includes(s)) throw new Error(`${LABEL} unknown symbol: ${s}`)
      out.symbols = list
    } else if (a === '--timeframe') {
      const list = parseList(argv[++i] ?? '')
      for (const t of list) if (!isTimeframe(t)) throw new Error(`${LABEL} unknown timeframe: ${t}`)
      out.timeframes = list as Timeframe[]
    } else if (a === '--from') {
      const v = argv[++i]
      if (v) out.from = v
    } else if (a === '--to') {
      const v = argv[++i]
      if (v) out.to = v
    } else if (a === '--full') out.full = true
    else if (a === '--concurrency') out.concurrency = parseIntArg(argv[++i], a, { min: 1 })
    else if (a === '--wallet-concurrency')
      out.walletConcurrency = parseIntArg(argv[++i], a, { min: 1 })
    else if (a === '--stale-after') out.staleAfterHours = parseIntArg(argv[++i], a, { min: 0 })
    else if (a === '--resample') out.resample = parseIntArg(argv[++i], a, { min: 0 })
    else if (a === '--skip') {
      for (const s of parseList(argv[++i] ?? '')) {
        if (!STAGE_KEYS.includes(s as StageKey)) throw new Error(`${LABEL} unknown stage: ${s}`)
        out.skip.add(s as StageKey)
      }
    } else if (a === '--dry-run') out.dryRun = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}

/**
 * Market-stage selectors. Each entry becomes one `--symbol X --timeframe Y`
 * invocation. Omitting a dimension yields a broader single call (the sub-scripts
 * treat a missing filter as "all"), so `--symbol btc` with no timeframe is one
 * call, not five.
 */
function marketSelectors(args: Args): string[][] {
  const symbols = args.symbols ?? [null as unknown as string]
  const timeframes = args.timeframes ?? [null as unknown as string]
  const out: string[][] = []
  for (const s of symbols) {
    for (const t of timeframes) {
      const sel: string[] = []
      if (s) sel.push('--symbol', s)
      if (t) sel.push('--timeframe', t)
      out.push(sel)
    }
  }
  return out
}

/**
 * The wrapper's completion verdict over the scope's stage counts.
 *
 * `partial`, `pending` and `processing` are non-failing states: expected work
 * (deep-backfill territory), a bounded `--limit` run, or a still-in-flight / a
 * crash-stranded claim. None is an error, but NONE may coexist with a "complete"
 * claim — reporting complete while a market is still `processing` (the gap this
 * closes) or while positions/activity are unfinished would be a lie about the
 * whole pipeline.
 *
 * A hard `failed` on ANY stage — trades, positions, or wallet activity — is a
 * real failure the wrapper must surface and exit non-zero on, because the
 * positions and activity stages persist `failed` per item and still exit 0, so
 * the wrapper is the only place their failures are gated. `complete` is only
 * claimed when nothing failed AND nothing is left unfinished anywhere.
 */
export type StageCounts = {
  done: number
  partial: number
  tradesFailed: number
  pending: number
  /** Trades markets stuck/in-flight in `processing`. */
  processing: number
  positionsFailed: number
  /** Positions markets in scope still `pending` or `processing` (0 if skipped). */
  positionsUnfinished: number
  activityFailed: number
  /** Wallets still `pending` or `processing` on activity (0 if skipped). */
  activityUnfinished: number
}

export function summaryVerdict(c: StageCounts): { hasFailures: boolean; complete: boolean } {
  const hasFailures = c.tradesFailed > 0 || c.positionsFailed > 0 || c.activityFailed > 0
  const complete =
    !hasFailures &&
    c.partial === 0 &&
    c.pending === 0 &&
    c.processing === 0 &&
    c.positionsUnfinished === 0 &&
    c.activityUnfinished === 0 &&
    c.done > 0
  return { hasFailures, complete }
}

export function plan(args: Args): Step[] {
  const selectors = marketSelectors(args)
  const steps: Step[] = []
  const add = (stage: StageKey, script: string, argsFor: (sel: string[]) => string[]) => {
    if (args.skip.has(stage)) return
    for (const sel of selectors) steps.push({ stage, script, args: argsFor(sel) })
  }

  const catalogExtra = [
    ...(args.full ? ['--full'] : []),
    ...(args.from ? ['--from', args.from] : []),
    ...(args.to ? ['--to', args.to] : []),
  ]
  add('markets', 'sync-markets.ts', (sel) => [...sel, ...catalogExtra])
  add('positions', 'sync-positions.ts', (sel) => [
    ...sel,
    '--concurrency',
    String(args.concurrency),
  ])
  add('trades', 'sync-trades.ts', (sel) => [...sel, '--concurrency', String(args.concurrency)])
  add('backfill', 'deep-backfill.ts', (sel) => [
    ...sel,
    '--wallet-concurrency',
    String(args.walletConcurrency),
  ])

  // Activity is wallet-based (not market-scoped), so it runs once regardless of
  // how many symbol/timeframe selectors there are.
  if (!args.skip.has('activity')) {
    steps.push({
      stage: 'activity',
      script: 'sync-activity.ts',
      args: [
        '--stale-after',
        String(args.staleAfterHours),
        '--concurrency',
        String(args.concurrency),
      ],
    })
  }

  add('verify', 'verify.ts', (sel) => [...sel, '--resample', String(args.resample)])
  if (!args.skip.has('catalog')) {
    steps.push({ stage: 'catalog', script: 'catalog.ts', args: [] })
  }
  return steps
}
