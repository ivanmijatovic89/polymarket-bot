import '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS } from '../config/telonex.js'
import {
  aggTradesDayPath,
  isoDateFromAggTradesFilename,
  pairFromFeedSymbol,
  utcDateRange,
  utcDateOf,
} from './paths.js'
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
      '  --sync                          auto-range: newest local day + 1 → yesterday (UTC);',
      '                                  falls back to TELONEX_DATASET_ELIGIBLE_FROM − 1 day when no local files',
      '  --concurrency N                 parallel downloads (default 4)',
      '  --force                         re-download even if parquet exists',
      '  --keep-zip                      keep the downloaded .zip in data/binance/tmp/',
      '  --dry-run                       preflight only (present / missing)',
      '  --strict                        any 404 is fatal (default: warn+skip for last 2 days)',
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
  if (!sync && !from) usage()
  return { pair, from, to: to || from, sync, concurrency, force, keepZip, dryRun, strict }
}

/** Newest local day file for the pair, or null when none exist yet. */
async function newestLocalDay(pair: string): Promise<string | null> {
  const dir = path.dirname(aggTradesDayPath(pair, '0000-00-00'))
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return null
  }
  let newest: string | null = null
  for (const n of names) {
    const d = isoDateFromAggTradesFilename(n)
    if (d && (!newest || d > newest)) newest = d
  }
  return newest
}

/**
 * `--sync` range: newest local day + 1 → yesterday (UTC). With no local files
 * yet, start one day BEFORE the Telonex eligibility floor so the feed
 * lookback margin is covered for the oldest eligible market.
 */
async function resolveSyncRange(pair: string): Promise<{ from: string; to: string } | null> {
  const DAY_MS = 86_400_000
  const newest = await newestLocalDay(pair)
  const fromMs = newest
    ? Date.parse(`${newest}T00:00:00Z`) + DAY_MS
    : TELONEX_DATASET_ELIGIBLE_FROM_MS - DAY_MS
  const toMs = Date.parse(`${utcDateOf(Date.now())}T00:00:00Z`) - DAY_MS
  if (fromMs > toMs) return null
  return { from: utcDateOf(fromMs), to: utcDateOf(toMs) }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'binance:download' })
  const args = parseArgs(process.argv.slice(2))
  if (args.sync) {
    const range = await resolveSyncRange(args.pair)
    if (!range) {
      console.log(`[binance:download] ${args.pair} is up to date (nothing newer than yesterday)`)
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

  const queue = [...missing]
  let downloaded = 0
  let skippedUnpublished = 0
  let totalBytes = 0
  let fatal: Error | undefined

  const worker = async (): Promise<void> => {
    while (!aborted && !fatal) {
      const date = queue.shift()
      if (!date) return
      let res: DownloadDayResult
      try {
        res = await downloadAggTradesDay({
          pair: args.pair,
          isoDate: date,
          force: args.force,
          keepZip: args.keepZip,
        })
      } catch (err) {
        fatal = err instanceof Error ? err : new Error(String(err))
        return
      }
      if (res.status === 'skipped-not-published') {
        if (args.strict || date < recentCutoff) {
          fatal = new Error(
            `[binance:download] dump not published: ${args.pair} ${date} (older than the ~1-day publication lag${args.strict ? '' : '; use --strict to silence this hint'})`,
          )
          return
        }
        skippedUnpublished++
        console.warn(
          `[binance:download] ${args.pair} ${date}: not published yet (~1-day lag) — skipped`,
        )
        continue
      }
      if (res.status === 'downloaded') {
        downloaded++
        totalBytes += res.bytes ?? 0
        console.log(
          `[binance:download] ${args.pair} ${date}: rows=${res.rows} ${fmtBytes(res.bytes ?? 0)} (${downloaded}/${missing.length})`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, queue.length) }, worker))

  if (fatal) {
    console.error(fatal.message)
    process.exit(1)
  }
  console.log(
    `[binance:download] done: downloaded=${downloaded} skipped-unpublished=${skippedUnpublished} total=${fmtBytes(totalBytes)}` +
      (aborted ? ' (aborted early)' : ''),
  )
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[binance:download] fatal:', err)
  process.exit(1)
})
