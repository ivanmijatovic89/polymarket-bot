import '../config/env.js'
import { promises as fs } from 'node:fs'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { fmtBytes } from '../utils/fmtBytes.js'
import { runWorkerPool } from '../utils/workerPool.js'
import { downloadR2ToLocal } from '../telonex/fetchConvertedToLocal.js'
import { getDefaultBucket, listObjects } from '../r2/client.js'
import { parseBinanceCliArgs, concurrencyFlag } from './cliArgs.js'
import {
  aggTradesDayDir,
  aggTradesDayPath,
  aggTradesR2Key,
  aggTradesR2Prefix,
  isoDateFromAggTradesFilename,
} from './paths.js'

/**
 * Worker-side pull: download every Binance aggTrades day file from the R2
 * mirror (`binance/aggTrades/<PAIR>/`) that is missing locally, to the
 * canonical local path the backtest feed loader reads. Atomic tmp→rename with
 * retries and size validation (via the shared `downloadR2ToLocal`),
 * skip-if-exists (files are immutable). Run before backtests / on a cron.
 *
 *   npm run binance:download-aggtrades-r2-to-local -- --pair BTCUSDT [--concurrency 6] [--dry-run] [--force]
 *
 * The feed loader itself never falls back to R2 — a missing file is a hard
 * per-market error by design (auditable data pipeline, no silent network).
 */

type Args = { pair: string; concurrency: number; force: boolean; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  let concurrency = 6
  let force = false
  let dryRun = false
  const { pair } = parseBinanceCliArgs({
    argv,
    usage:
      'Usage: npm run binance:download-aggtrades-r2-to-local -- --pair BTCUSDT [--concurrency 6] [--force] [--dry-run]',
    flags: {
      '--concurrency': concurrencyFlag(6, (n) => (concurrency = n)),
      '--force': { kind: 'boolean', set: () => (force = true) },
      '--dry-run': { kind: 'boolean', set: () => (dryRun = true) },
    },
  })
  return { pair, concurrency, force, dryRun }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'binance:r2-to-local' })
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()

  // Only exact canonical keys count: a nested/backup/foreign key under the
  // prefix must never be downloaded onto a canonical local path (and duplicate
  // dates would make two workers write the same tmp file concurrently).
  const remote = (await listObjects(bucket, aggTradesR2Prefix(args.pair)))
    .flatMap((o) => {
      const date = isoDateFromAggTradesFilename(o.key, args.pair)
      return date && o.key === aggTradesR2Key(args.pair, date) ? [{ ...o, date }] : []
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // Local inventory with sizes: a local file whose size differs from the R2
  // object (producer regenerated the day after a converter fix) is
  // re-downloaded, so drift propagates the last hop R2 → worker too.
  const localSizeByDate = new Map<string, number>()
  try {
    const names = await fs.readdir(aggTradesDayDir(args.pair))
    await Promise.all(
      names.map(async (n) => {
        const d = isoDateFromAggTradesFilename(n, args.pair)
        if (!d) return
        try {
          localSizeByDate.set(d, (await fs.stat(aggTradesDayPath(args.pair, d))).size)
        } catch {
          // treat as missing
        }
      }),
    )
  } catch {
    // No local directory yet — everything is missing; downloadR2ToLocal creates it.
  }

  const jobs = remote.filter((o) => args.force || localSizeByDate.get(o.date) !== o.size)
  const onLocal = remote.length - jobs.length
  let sizeDrift = 0
  for (const job of jobs) {
    const localSize = localSizeByDate.get(job.date)
    if (localSize !== undefined && localSize !== job.size && !args.force) {
      sizeDrift++
      console.warn(
        `[binance:r2-to-local] ${args.pair} ${job.date}: size drift (local=${localSize} r2=${job.size}) — re-downloading`,
      )
    }
  }

  console.log(
    `[binance:r2-to-local] pair=${args.pair} bucket=${bucket} on-r2=${remote.length} on-local=${onLocal} to-download=${jobs.length}` +
      (sizeDrift > 0 ? ` (size-drift=${sizeDrift})` : '') +
      (args.force ? ' force' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (remote.length === 0) {
    console.error(
      `[binance:r2-to-local] no day files under r2://${bucket}/${aggTradesR2Prefix(args.pair)} — ` +
        `wrong R2_BUCKET / pair, or the producer upload has not run yet (binance:upload-aggtrades-r2)`,
    )
    process.exit(2)
  }
  if (args.dryRun || jobs.length === 0) return

  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(`[binance:r2-to-local] ${sig} — finishing in-flight downloads, then stopping`)
      aborted = true
    },
  })

  let downloaded = 0
  let totalBytes = 0

  const fatal = await runWorkerPool({
    jobs,
    concurrency: args.concurrency,
    isAborted: () => aborted,
    run: async (job) => {
      await downloadR2ToLocal(`r2://${bucket}/${job.key}`, aggTradesDayPath(args.pair, job.date), {
        expectedBytes: job.size,
      })
      downloaded++
      totalBytes += job.size
      console.log(
        `[binance:r2-to-local] ${args.pair} ${job.date}: ${fmtBytes(job.size)} (${downloaded}/${jobs.length})`,
      )
    },
  })

  if (fatal) {
    console.error('[binance:r2-to-local] fatal:', fatal.message)
    process.exit(1)
  }
  console.log(
    `[binance:r2-to-local] done: downloaded=${downloaded} total=${fmtBytes(totalBytes)}` +
      (aborted ? ' (aborted early)' : ''),
  )
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[binance:r2-to-local] fatal:', err)
  process.exit(1)
})
