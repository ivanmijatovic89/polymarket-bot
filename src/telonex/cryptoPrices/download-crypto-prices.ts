import '../../config/env.js'
import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'
import { installSignalHandlers, installProcessCrashHandlers } from '../../utils/runtime.js'
import { fileExists } from '../../utils/fs.js'
import { fmtBytes } from '../../utils/fmtBytes.js'
import { runWorkerPool } from '../../utils/workerPool.js'
import { getInMemoryDuckDb, sqlQuote } from '../../utils/duckdb.js'
import { utcDateOf, utcDateRange } from '../../binance/paths.js'
import { HttpError, fetchTelonexFile, readTelonexApiKey } from '../telonexHttp.js'
import { parseCryptoPricesCliArgs, concurrencyFlag } from './cliArgs.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM,
  cryptoPricesDayDir,
  cryptoPricesDayPath,
  cryptoPricesDownloadUrl,
} from './paths.js'

/**
 * Producer CLI: download Telonex `crypto_prices` day files (Chainlink oracle
 * ticks) to their canonical local paths. Files are stored EXACTLY as delivered
 * (no conversion) after an integrity gate: MD5 vs the source ETag (warn-only,
 * single-part uploads only) and a DuckDB readability + row/asset sanity check
 * (fatal — a truncated or foreign parquet must never land on a canonical path).
 *
 *   npm run telonex:crypto-prices:download -- --asset btcusd (--from YYYY-MM-DD [--to ...] | --sync)
 *
 * `--sync` scans the FULL expected range (coverage start 2026-04-02 →
 * yesterday UTC) and downloads whatever is missing — self-healing: a day that
 * failed mid-run, was skipped while unpublished, or was deleted locally is
 * retried on the next run, so a hole can never become permanent.
 *
 * 403 (download limit / lapsed subscription) aborts the WHOLE run cleanly —
 * unlike 404/429 it can't be solved by retrying other days, and burning the
 * remaining queue against it would only spam the API.
 */

type Args = {
  assetId: string
  from: string
  to: string
  sync: boolean
  concurrency: number
  force: boolean
  dryRun: boolean
  strict: boolean
}

const USAGE = [
  'Usage: npm run telonex:crypto-prices:download -- --asset btcusd (--from YYYY-MM-DD [--to YYYY-MM-DD] | --sync)',
  '  --asset btcusd | --symbol btc   (btc|eth|sol|xrp|bnb|doge|hype → <sym>usd)',
  '  --from YYYY-MM-DD               first UTC date (inclusive)',
  '  --to YYYY-MM-DD                 last UTC date (inclusive; default: --from)',
  `  --sync                          full expected range: ${CRYPTO_PRICES_COVERAGE_FROM} (coverage start) → yesterday (UTC);`,
  '                                  skip-if-exists makes this self-healing — holes are re-downloaded',
  '  --concurrency N                 parallel downloads (default 2 — downloads may be metered)',
  '  --force                         re-download even if the file exists (explicit --from/--to only)',
  '  --dry-run                       preflight only (present / missing)',
  '  --strict                        any 404 is fatal (default: warn+skip for the trailing 2 days)',
].join('\n')

function parseArgs(argv: string[]): Args {
  let from = ''
  let to = ''
  let sync = false
  let concurrency = 2
  let force = false
  let dryRun = false
  let strict = false
  const { assetId } = parseCryptoPricesCliArgs({
    argv,
    usage: USAGE,
    flags: {
      '--from': { kind: 'value', set: (v) => (from = v) },
      '--to': { kind: 'value', set: (v) => (to = v) },
      '--sync': { kind: 'boolean', set: () => (sync = true) },
      '--concurrency': concurrencyFlag(2, (n) => (concurrency = n)),
      '--force': { kind: 'boolean', set: () => (force = true) },
      '--dry-run': { kind: 'boolean', set: () => (dryRun = true) },
      '--strict': { kind: 'boolean', set: () => (strict = true) },
    },
  })
  const fail = (msg: string): never => {
    console.error(msg)
    console.error(USAGE)
    process.exit(2)
  }
  if (sync && (from || to)) fail('--sync and --from/--to are mutually exclusive')
  if (sync && force)
    fail(
      '--sync --force would re-download the entire history; to refresh specific days, use --from/--to with --force',
    )
  if (!sync && !from) fail('missing --from (or --sync)')
  return { assetId, from, to: to || from, sync, concurrency, force, dryRun, strict }
}

/**
 * `--sync` range: coverage start → yesterday UTC. Today's file cannot exist
 * (Telonex publishes daily after midnight UTC), so it is never requested.
 */
function resolveSyncRange(): { from: string; to: string } {
  const DAY_MS = 86_400_000
  return {
    from: CRYPTO_PRICES_COVERAGE_FROM,
    to: utcDateOf(Date.parse(`${utcDateOf(Date.now())}T00:00:00Z`) - DAY_MS),
  }
}

/**
 * Fatal integrity gate before the tmp→rename: the parquet must be readable by
 * DuckDB, non-empty, and carry ONLY the requested asset. Guards against
 * truncated transfers and any server-side mixup landing on a canonical path.
 */
async function validateDayParquet(tmpPath: string, assetId: string): Promise<number> {
  const db = await getInMemoryDuckDb()
  const conn = await db.connect()
  try {
    const res = await conn.run(
      `SELECT count(*), count(DISTINCT asset_id),
              count(*) FILTER (WHERE asset_id <> ${sqlQuote(assetId)})
       FROM read_parquet(${sqlQuote(tmpPath)})`,
    )
    const row = res.getChunk(0).getRows()[0]!
    const rows = Number(row[0])
    const foreign = Number(row[2])
    if (rows === 0) throw new Error('file contains zero rows')
    if (foreign > 0) throw new Error(`file contains ${foreign} row(s) for a different asset_id`)
    return rows
  } finally {
    conn.closeSync()
  }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'crypto-prices:download' })
  const args = parseArgs(process.argv.slice(2))
  const apiKey = readTelonexApiKey('crypto-prices:download')
  if (args.sync) {
    const range = resolveSyncRange()
    args.from = range.from
    args.to = range.to
    console.log(`[crypto-prices:download] --sync resolved range: ${args.from}..${args.to}`)
  }
  const dates = utcDateRange(args.from, args.to)

  // Preflight: which dates are already on disk.
  const missing: string[] = []
  let present = 0
  for (const d of dates) {
    if (!args.force && (await fileExists(cryptoPricesDayPath(args.assetId, d)))) present++
    else missing.push(d)
  }
  console.log(
    `[crypto-prices:download] asset=${args.assetId} dates=${dates.length} (${args.from}..${args.to}) ` +
      `present=${present} to-download=${missing.length} concurrency=${args.concurrency}` +
      (args.force ? ' force' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (args.dryRun || missing.length === 0) return

  await fs.mkdir(cryptoPricesDayDir(args.assetId), { recursive: true })

  // Files for the trailing ~2 days may not be published yet.
  const recentCutoff = utcDateOf(Date.now() - 2 * 86_400_000)

  const abortController = new AbortController()
  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(`[crypto-prices:download] ${sig} — finishing in-flight downloads, then stopping`)
      aborted = true
      abortController.abort()
    },
  })

  let downloaded = 0
  let skippedUnpublished = 0
  let totalBytes = 0
  let lastRemaining: number | null = null
  const notFound: string[] = []

  const fatal = await runWorkerPool({
    jobs: missing,
    concurrency: args.concurrency,
    isAborted: () => aborted,
    run: async (date) => {
      const url = cryptoPricesDownloadUrl(args.assetId, date)
      const fetched = await fetchTelonexFile(url, apiKey, abortController.signal)
      if ('notFound' in fetched) {
        if (args.strict) {
          throw new Error(
            `[crypto-prices:download] file not found: ${args.assetId} ${date} (fatal because of --strict — drop it to collect 404s and keep downloading other days)`,
          )
        }
        if (date < recentCutoff) {
          // Older than the publication lag: the file should exist. Do NOT
          // abort — a permanent gap must never block newer days from syncing
          // (the run still exits 1 with a summary below).
          notFound.push(date)
          console.error(
            `[crypto-prices:download] file not found: ${args.assetId} ${date} — past the ~1-day publication lag, so it should exist; continuing with other days`,
          )
          return
        }
        skippedUnpublished++
        console.warn(
          `[crypto-prices:download] ${args.assetId} ${date}: not published yet (~1-day lag) — skipped; the next --sync run retries it`,
        )
        return
      }

      // Telonex source ETag for single-part is MD5 — log mismatch but proceed
      // (the DuckDB readability gate below is the authoritative check).
      const md5Hex = crypto.createHash('md5').update(fetched.buffer).digest('hex')
      if (
        fetched.sourceEtag &&
        !fetched.sourceEtag.includes('-') &&
        fetched.sourceEtag !== md5Hex
      ) {
        console.warn(
          `[crypto-prices:download] WARN source ETag mismatch for ${args.assetId} ${date}: src=${fetched.sourceEtag} local=${md5Hex}`,
        )
      }

      const finalPath = cryptoPricesDayPath(args.assetId, date)
      const tmpPath = `${finalPath}.${process.pid}.tmp`
      try {
        await fs.writeFile(tmpPath, fetched.buffer)
        const rows = await validateDayParquet(tmpPath, args.assetId)
        await fs.rename(tmpPath, finalPath)
        downloaded++
        totalBytes += fetched.buffer.length
        lastRemaining = fetched.downloadsRemaining ?? lastRemaining
        console.log(
          `[crypto-prices:download] ${args.assetId} ${date}: rows=${rows} ${fmtBytes(fetched.buffer.length)} (${downloaded}/${missing.length})` +
            (fetched.downloadsRemaining !== null ? ` remaining=${fetched.downloadsRemaining}` : ''),
        )
      } catch (err) {
        await fs.rm(tmpPath, { force: true }).catch(() => {})
        throw err
      }
    },
  })

  if (fatal) {
    if (fatal instanceof HttpError && fatal.kind === 'downloadLimit') {
      console.error(
        `[crypto-prices:download] ABORTED — ${fatal.message}. Progress is saved (skip-if-exists); ` +
          `re-run \`--sync\` after the limit resets or the subscription is fixed.`,
      )
      process.exit(3)
    }
    console.error(fatal.message)
    process.exit(1)
  }
  console.log(
    `[crypto-prices:download] done: downloaded=${downloaded} skipped-unpublished=${skippedUnpublished} not-found=${notFound.length} total=${fmtBytes(totalBytes)}` +
      (lastRemaining !== null ? ` downloads-remaining=${lastRemaining}` : '') +
      (aborted ? ' (aborted early)' : ''),
  )
  if (notFound.length > 0) {
    notFound.sort()
    console.error(
      `[crypto-prices:download] ${notFound.length} file(s) not found past the publication lag: ${notFound.join(', ')} — ` +
        `mistyped asset (${args.assetId})? Telonex-side gap? Backtests touching these days will hard-error until resolved.`,
    )
    process.exit(1)
  }
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[crypto-prices:download] fatal:', err)
  process.exit(1)
})
