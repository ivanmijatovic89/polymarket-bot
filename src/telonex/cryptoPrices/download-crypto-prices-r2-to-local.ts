import '../../config/env.js'
import { promises as fs } from 'node:fs'
import { installSignalHandlers, installProcessCrashHandlers } from '../../utils/runtime.js'
import { fmtBytes } from '../../utils/fmtBytes.js'
import { runWorkerPool } from '../../utils/workerPool.js'
import { downloadR2ToLocal } from '../fetchConvertedToLocal.js'
import { getDefaultBucket, listObjects } from '../../r2/client.js'
import { parseCryptoPricesCliArgs, concurrencyFlag } from './cliArgs.js'
import {
  cryptoPricesDayDir,
  cryptoPricesDayPath,
  cryptoPricesR2Key,
  cryptoPricesR2Prefix,
  isoDateFromCryptoPricesFilename,
} from './paths.js'

/**
 * Worker-side pull: download every Telonex `crypto_prices` day file from the
 * R2 mirror that is missing locally, to the canonical local path the backtest
 * feed loader reads. Atomic tmp→rename with retries and size validation (via
 * the shared `downloadR2ToLocal`), skip-if-exists with size-drift re-download.
 * Run before backtests / on a cron.
 *
 *   npm run telonex:crypto-prices:download-r2-to-local -- --asset btcusd [--concurrency 6] [--dry-run] [--force]
 *
 * The feed loader itself never falls back to R2 — a missing file is a hard
 * per-market error by design (auditable data pipeline, no silent network).
 */

type Args = { assetId: string; concurrency: number; force: boolean; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  let concurrency = 6
  let force = false
  let dryRun = false
  const { assetId } = parseCryptoPricesCliArgs({
    argv,
    usage:
      'Usage: npm run telonex:crypto-prices:download-r2-to-local -- --asset btcusd [--concurrency 6] [--force] [--dry-run]',
    flags: {
      '--concurrency': concurrencyFlag(6, (n) => (concurrency = n)),
      '--force': { kind: 'boolean', set: () => (force = true) },
      '--dry-run': { kind: 'boolean', set: () => (dryRun = true) },
    },
  })
  return { assetId, concurrency, force, dryRun }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'crypto-prices:r2-to-local' })
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()

  // Only exact canonical keys count: a nested/backup/foreign key under the
  // prefix must never be downloaded onto a canonical local path.
  const remote = (await listObjects(bucket, cryptoPricesR2Prefix(args.assetId)))
    .flatMap((o) => {
      const date = isoDateFromCryptoPricesFilename(o.key, args.assetId)
      return date && o.key === cryptoPricesR2Key(args.assetId, date) ? [{ ...o, date }] : []
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // Local inventory with sizes: a local file whose size differs from the R2
  // object (producer regenerated the day) is re-downloaded, so drift
  // propagates the last hop R2 → worker too.
  const localSizeByDate = new Map<string, number>()
  try {
    const names = await fs.readdir(cryptoPricesDayDir(args.assetId))
    await Promise.all(
      names.map(async (n) => {
        const d = isoDateFromCryptoPricesFilename(n, args.assetId)
        if (!d) return
        try {
          localSizeByDate.set(d, (await fs.stat(cryptoPricesDayPath(args.assetId, d))).size)
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
        `[crypto-prices:r2-to-local] ${args.assetId} ${job.date}: size drift (local=${localSize} r2=${job.size}) — re-downloading`,
      )
    }
  }

  console.log(
    `[crypto-prices:r2-to-local] asset=${args.assetId} bucket=${bucket} on-r2=${remote.length} on-local=${onLocal} to-download=${jobs.length}` +
      (sizeDrift > 0 ? ` (size-drift=${sizeDrift})` : '') +
      (args.force ? ' force' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (remote.length === 0) {
    console.error(
      `[crypto-prices:r2-to-local] no day files under r2://${bucket}/${cryptoPricesR2Prefix(args.assetId)} — ` +
        `wrong R2_BUCKET / asset, or the producer upload has not run yet (telonex:crypto-prices:upload-r2)`,
    )
    process.exit(2)
  }
  if (args.dryRun || jobs.length === 0) return

  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(
        `[crypto-prices:r2-to-local] ${sig} — finishing in-flight downloads, then stopping`,
      )
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
      await downloadR2ToLocal(
        `r2://${bucket}/${job.key}`,
        cryptoPricesDayPath(args.assetId, job.date),
        { expectedBytes: job.size },
      )
      downloaded++
      totalBytes += job.size
      console.log(
        `[crypto-prices:r2-to-local] ${args.assetId} ${job.date}: ${fmtBytes(job.size)} (${downloaded}/${jobs.length})`,
      )
    },
  })

  if (fatal) {
    console.error('[crypto-prices:r2-to-local] fatal:', fatal)
    process.exit(1)
  }
  console.log(
    `[crypto-prices:r2-to-local] done: downloaded=${downloaded} total=${fmtBytes(totalBytes)}` +
      (aborted ? ' (aborted early)' : ''),
  )
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[crypto-prices:r2-to-local] fatal:', err)
  process.exit(1)
})
