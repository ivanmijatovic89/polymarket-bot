import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS, telonexDatasetMaxStartMs } from '../../config/telonex.js'
import { closeDb } from '../../db/index.js'
import {
  listEligibleTelonexSlugs,
  saveTelonexFeedUsability,
  countTelonexFeedUsabilityChanges,
  type ReadFrom,
} from '../../db/telonexMarkets.js'
import { windowFromSlug } from '../../polymarket/upDownSlugWindow.js'
import {
  coverageStatus,
  FEED_USABILITY_MAX_GAP_MS,
  feedUsabilityUpdates,
  measureFeedCoverage,
  summarizeFeedCoverage,
  type CoverageFeed,
} from '../../backtest/feeds/feedCoverageCheck.js'

const USAGE = `--symbol btc --timeframe 15m --from YYYY-MM-DD --to YYYY-MM-DD
  [--max-gap-seconds 10] [--read-from r2|local] [--output report.json] [--save] [--dry-run]
Use --sync instead of --from/--to to check the full eligible date range.
Use --timeframe all to check every cataloged timeframe for this symbol.
Dates are inclusive UTC dates of market starts. Checks all eligible converted
markets in that range (no market limit). Reads local feed files; does not download
or run backtests. Read-only unless --save is supplied. Producer-only --save writes
this feed's verified results at the fixed 10s rule; unverified results are skipped.
--read-from selects the orderbook eligibility filter only (default r2).
A gap equal to the allowed maximum passes.`

export function parseFeedCoverageArgs(argv: string[]) {
  const options = new Map<string, string>()
  let save = false
  let sync = false
  let dryRun = false
  const allowed = new Set([
    '--symbol',
    '--timeframe',
    '--from',
    '--to',
    '--max-gap-seconds',
    '--read-from',
    '--output',
  ])
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!
    if (key === '--sync' || key === '--dry-run') {
      if (options.has(key)) throw new Error(`duplicate ${key} argument`)
      options.set(key, 'true')
      if (key === '--sync') sync = true
      else dryRun = true
      continue
    }
    if (key === '--save') {
      if (save) throw new Error('duplicate --save argument')
      save = true
      continue
    }
    const value = argv[++i]
    if (!allowed.has(key) || !value || value.startsWith('--') || options.has(key)) {
      throw new Error(`invalid, missing, or duplicate argument: ${key}\n${USAGE}`)
    }
    options.set(key, value)
  }
  const date = (key: string): number => {
    const value = options.get(key) ?? ''
    const ms = Date.parse(`${value}T00:00:00Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 10) !== value
    ) {
      throw new Error(`${key} must be a valid YYYY-MM-DD date\n${USAGE}`)
    }
    return ms
  }
  const symbol = (options.get('--symbol') ?? '').toLowerCase()
  const timeframe = options.get('--timeframe') ?? '15m'
  if (
    !/^[a-z0-9]+$/.test(symbol) ||
    (timeframe !== 'all' && !windowFromSlug(`${symbol}-updown-${timeframe}-1`))
  ) {
    throw new Error(`invalid symbol or timeframe\n${USAGE}`)
  }
  if (sync && (options.has('--from') || options.has('--to'))) {
    throw new Error('--sync cannot be combined with --from/--to')
  }
  const fromMs = sync ? TELONEX_DATASET_ELIGIBLE_FROM_MS : date('--from')
  const toMs = sync ? telonexDatasetMaxStartMs() : date('--to') + 86_400_000 - 1
  if (toMs < fromMs) throw new Error('--to must not precede --from')
  const allowedGapMs = options.has('--max-gap-seconds')
    ? Number(options.get('--max-gap-seconds')) * 1000
    : FEED_USABILITY_MAX_GAP_MS
  if (!Number.isSafeInteger(allowedGapMs) || allowedGapMs <= 0) {
    throw new Error('--max-gap-seconds must be positive with at most millisecond precision')
  }
  if (save && allowedGapMs !== FEED_USABILITY_MAX_GAP_MS) {
    throw new Error('--save requires --max-gap-seconds 10; alternate thresholds are report-only')
  }
  const readFrom = options.get('--read-from') ?? 'r2'
  if (readFrom !== 'r2' && readFrom !== 'local') throw new Error('--read-from must be r2 or local')
  return {
    symbol,
    timeframe,
    fromMs,
    toMs,
    allowedGapMs,
    save,
    dryRun,
    readFrom: readFrom as ReadFrom,
    output: options.get('--output'),
  }
}

export async function runFeedCoverageCheck(
  feed: CoverageFeed,
  argv: string[],
  isAborted: () => boolean = () => false,
): Promise<void> {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(USAGE)
    return
  }
  const options = parseFeedCoverageArgs(argv)
  try {
    const query = {
      symbol: options.symbol,
      ...(options.timeframe === 'all' ? {} : { timeframe: options.timeframe }),
      fromMs: options.fromMs,
      toMs: options.toMs,
      readFrom: options.readFrom,
    }
    // Flags belong to market windows, independently of the orderbook converter.
    const slugs = [
      ...new Set(
        (
          await Promise.all([
            listEligibleTelonexSlugs({ ...query, converter: 'delta-typed' }),
            listEligibleTelonexSlugs({ ...query, converter: 'paired' }),
          ])
        ).flat(),
      ),
    ]
    const windows = slugs.map((slug) => {
      const window = windowFromSlug(slug)
      if (!window) throw new Error(`cannot determine market window: ${slug}`)
      return { slug, ...window }
    })
    if (windows.length === 0) {
      console.log(`[${feed}:coverage] usable=0 unusable=0 unverified=0 total=0`)
      return
    }
    console.log(
      `[${feed}:coverage] checking ${windows.length} eligible ${options.symbol} ${options.timeframe} markets`,
    )
    const results = await measureFeedCoverage({
      feed,
      symbol: options.symbol,
      windows,
      onDay: (date, completed, total) => {
        if (isAborted()) throw new Error('Feed verification aborted; results were not saved')
        if (completed % 20 === 0 || completed === total)
          console.log(`[${feed}:coverage] ${completed}/${total} days (${date})`)
      },
    })
    const summary = summarizeFeedCoverage(results, options.allowedGapMs)
    const comparisons = [...new Set([options.allowedGapMs, 5_000, 10_000, 15_000, 30_000, 60_000])]
      .sort((a, b) => a - b)
      .map((gap) => summarizeFeedCoverage(results, gap))
    console.table(
      comparisons.map(({ allowedGapMs, usable, unusable, unverified }) => ({
        maxGapSeconds: allowedGapMs / 1000,
        usable,
        unusable,
        unverified,
      })),
    )
    if (isAborted()) throw new Error('Feed verification aborted; results were not saved')
    const persisted =
      options.save && !options.dryRun
        ? await saveTelonexFeedUsability({
            feed,
            symbol: options.symbol,
            results: feedUsabilityUpdates(results),
          })
        : null
    if (persisted !== null) {
      console.log(
        `[${feed}:coverage] saved ${persisted} verified results; left ${summary.unverified} unverified results unchanged`,
      )
    }
    const flagsToSave =
      options.save && options.dryRun
        ? await countTelonexFeedUsabilityChanges({
            feed,
            symbol: options.symbol,
            results: feedUsabilityUpdates(results),
          })
        : 0
    console.log(
      `[${feed}:coverage] usable=${summary.usable} unusable=${summary.unusable} unverified=${summary.unverified} total=${summary.total} flags-to-save=${flagsToSave}${options.dryRun ? ' DRY-RUN' : ''}`,
    )
    if (options.output) {
      const reportPath = path.resolve(options.output)
      await mkdir(path.dirname(reportPath), { recursive: true })
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            feed,
            symbol: options.symbol,
            timeframe: options.timeframe,
            generatedAt: new Date().toISOString(),
            from: new Date(options.fromMs).toISOString(),
            to: new Date(options.toMs).toISOString(),
            converters: ['delta-typed', 'paired'],
            readFrom: options.readFrom,
            gapClock: feed === 'binance' ? 'trade timestamp' : 'round timestamp',
            rule: 'unusable when maxGapMs > allowedGapMs, no rows, or invalid rows; missing/unreadable files are unverified',
            summary,
            persisted,
            comparisons,
            markets: results.map((result) => ({
              ...result,
              status: coverageStatus(result, options.allowedGapMs),
            })),
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      )
      console.log(`[${feed}:coverage] report: ${reportPath}`)
    }
    // Known gaps are a successful measurement. Unverified data needs attention.
    if (summary.unverified > 0) process.exitCode = 1
  } finally {
    await closeDb()
  }
}

/** Shared completion step for the two producer upload commands, including no-op uploads. */
export async function checkUploadedFeedCoverage(
  feed: CoverageFeed,
  sourceSymbol: string,
  dryRun: boolean,
  isAborted: () => boolean = () => false,
): Promise<void> {
  const symbol = marketSymbolForUploadedFeed(feed, sourceSymbol)
  if (symbol === null) {
    console.log(`[${feed}:coverage] ${sourceSymbol} has no matching market-symbol usability flag`)
    return
  }
  await runFeedCoverageCheck(
    feed,
    [
      '--symbol',
      symbol,
      '--timeframe',
      'all',
      '--sync',
      '--save',
      ...(dryRun ? ['--dry-run'] : []),
    ],
    isAborted,
  )
}

export function marketSymbolForUploadedFeed(
  feed: CoverageFeed,
  sourceSymbol: string,
): string | null {
  const match = sourceSymbol
    .toLowerCase()
    .match(feed === 'binance' ? /^([a-z0-9]+)usdt$/ : /^([a-z0-9]+)usd$/)
  return match?.[1] ?? null
}
