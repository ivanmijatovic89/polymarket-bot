import '../config/env.js'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { fileExists } from '../utils/fs.js'
import { fmtBytes } from '../utils/fmtBytes.js'
import { runWorkerPool } from '../utils/workerPool.js'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS } from '../config/telonex.js'
import { aggTradesDayPath, pairFromFeedSymbol, utcDateRange, utcDateOf } from './paths.js'
import { downloadAggTradesDay, type DownloadDayResult } from './aggTradesDump.js'

type Args = {
  pair: string
  from: string
  to: string
  sync: boolean
  concurrency: number
  force: boolean
  keepZip: boolean
  dryRun: boolean
  strict: boolean
}

function usage(): never {
  console.error(
    [
      'Usage: npm run binance:download-aggtrades -- --pair BTCUSDT (--from YYYY-MM-DD [--to YYYY-MM-DD] | --sync)',
      '  --pair BTCUSDT | --symbol btc   (btc|eth|sol|xrp → <SYM>USDT)',
      '  --from YYYY-MM-DD               first UTC date (inclusive)',
      '  --to YYYY-MM-DD                 last UTC date (inclusive; default: --from)',
      '  --sync                          full expected range: TELONEX_DATASET_ELIGIBLE_FROM − 1 day → yesterday (UTC);',
      '                                  skip-if-exists makes this self-healing — holes are re-downloaded',
      '  --concurrency N                 parallel downloads (default 4)',
      '  --force                         re-download even if parquet exists (explicit --from/--to only)',
      '  --keep-zip                      keep the downloaded .zip in data/binance/tmp/',
      '  --dry-run                       preflight only (present / missing)',
      '  --strict                        abort on the first 404 (default: last 2 days warn+skip;',
      '                                  older 404s are collected, other days still download, exit 1)',
    ].join('\n'),
  )
  process.exit(2)
}

function parseArgs(argv: string[]): Args {
  let pair = ''
  let from = ''
  let to = ''
  let sync = false
  let concurrency = 4
  let force = false
  let keepZip = false
  let dryRun = false
  let strict = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) usage()
      return v
    }
    if (a === '--pair') pair = pairFromFeedSymbol(next())
    else if (a === '--symbol') pair = pairFromFeedSymbol(`${next()}usdt`)
    else if (a === '--from') from = next()
    else if (a === '--to') to = next()
    else if (a === '--sync') sync = true
    else if (a === '--concurrency') concurrency = Math.max(1, Number(next()) || 4)
    else if (a === '--force') force = true
    else if (a === '--keep-zip') keepZip = true
    else if (a === '--dry-run') dryRun = true
    else if (a === '--strict') strict = true
    else {
      console.error(`[binance:download] unknown arg: ${a}`)
      usage()
    }
  }
  if (!pair) usage()
  if (sync && (from || to)) {
    console.error('[binance:download] --sync and --from/--to are mutually exclusive')
    usage()
  }
  if (sync && force) {
    console.error(
      '[binance:download] --sync --force would re-download the entire history; to refresh specific days, use --from/--to with --force',
    )
    usage()
  }
  if (!sync && !from) usage()
  return { pair, from, to: to || from, sync, concurrency, force, keepZip, dryRun, strict }
}

/**
 * `--sync` range: the FULL expected window, TELONEX_DATASET_ELIGIBLE_FROM − 1
 * day (feed lookback margin for the oldest eligible market) → yesterday (UTC).
 * The skip-if-exists preflight below turns this into "download whatever is
 * missing", which makes the daily cron self-healing: a day that failed
 * mid-run, was skipped as not-yet-published, or was deleted locally is picked
 * up again on the next run — a hole can never become permanent. (Deriving the
 * range from the newest local file instead would silently skip such holes.)
 */
function resolveSyncRange(): { from: string; to: string } | null {
  const DAY_MS = 86_400_000
  const fromMs = TELONEX_DATASET_ELIGIBLE_FROM_MS - DAY_MS
  const toMs = Date.parse(`${utcDateOf(Date.now())}T00:00:00Z`) - DAY_MS
  if (fromMs > toMs) return null
  return { from: utcDateOf(fromMs), to: utcDateOf(toMs) }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'binance:download' })
  const args = parseArgs(process.argv.slice(2))
  if (args.sync) {
    const range = resolveSyncRange()
    if (!range) {
      console.log(
        `[binance:download] ${args.pair}: eligibility floor is in the future — nothing to sync`,
      )
      return
    }
    args.from = range.from
    args.to = range.to
    console.log(`[binance:download] --sync resolved range: ${args.from}..${args.to}`)
  }
  const dates = utcDateRange(args.from, args.to)

  // Preflight: which dates are already on disk.
  const missing: string[] = []
  let present = 0
  for (const d of dates) {
    if (!args.force && (await fileExists(aggTradesDayPath(args.pair, d)))) present++
    else missing.push(d)
  }
  console.log(
    `[binance:download] pair=${args.pair} dates=${dates.length} (${args.from}..${args.to}) ` +
      `present=${present} to-download=${missing.length} concurrency=${args.concurrency}` +
      (args.force ? ' force' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (args.dryRun || missing.length === 0) return

  // Dumps for the trailing ~2 days may not be published yet.
  const recentCutoff = utcDateOf(Date.now() - 2 * 86_400_000)

  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(`[binance:download] ${sig} — finishing in-flight downloads, then stopping`)
      aborted = true
    },
  })

  let downloaded = 0
  let skippedUnpublished = 0
  let totalBytes = 0
  const notFound: string[] = []

  const fatal = await runWorkerPool({
    jobs: missing,
    concurrency: args.concurrency,
    isAborted: () => aborted,
    run: async (date) => {
      const res: DownloadDayResult = await downloadAggTradesDay({
        pair: args.pair,
        isoDate: date,
        force: args.force,
        keepZip: args.keepZip,
      })
      if (res.status === 'skipped-not-published') {
        if (args.strict) {
          throw new Error(
            `[binance:download] dump not found: ${args.pair} ${date} (fatal because of --strict — drop it to collect 404s and keep downloading other days)`,
          )
        }
        if (date < recentCutoff) {
          // Older than the publication lag: the dump should exist, so a 404
          // usually means a mistyped pair or a genuine Binance-side gap. Do
          // NOT abort — a permanent gap must never block newer days from
          // syncing (the run still exits 1 with a summary below).
          notFound.push(date)
          console.error(
            `[binance:download] dump not found: ${args.pair} ${date} — past the ~1-day publication lag, so it should exist; continuing with other days`,
          )
          return
        }
        skippedUnpublished++
        console.warn(
          `[binance:download] ${args.pair} ${date}: not published yet (~1-day lag) — skipped; the next --sync run retries it`,
        )
        return
      }
      if (res.status === 'downloaded') {
        downloaded++
        totalBytes += res.bytes ?? 0
        console.log(
          `[binance:download] ${args.pair} ${date}: rows=${res.rows} ${fmtBytes(res.bytes ?? 0)} (${downloaded}/${missing.length})`,
        )
      }
    },
  })

  if (fatal) {
    console.error(fatal.message)
    process.exit(1)
  }
  console.log(
    `[binance:download] done: downloaded=${downloaded} skipped-unpublished=${skippedUnpublished} not-found=${notFound.length} total=${fmtBytes(totalBytes)}` +
      (aborted ? ' (aborted early)' : ''),
  )
  if (notFound.length > 0) {
    notFound.sort()
    console.error(
      `[binance:download] ${notFound.length} dump(s) not found past the publication lag: ${notFound.join(', ')} — ` +
        `mistyped pair (${args.pair})? Binance-side gap? Backtests touching these days will hard-error until resolved.`,
    )
    process.exit(1)
  }
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[binance:download] fatal:', err)
  process.exit(1)
})
