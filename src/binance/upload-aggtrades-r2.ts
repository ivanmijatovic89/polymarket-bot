import '../config/env.js'
import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { fmtBytes } from '../utils/fmtBytes.js'
import { runWorkerPool } from '../utils/workerPool.js'
import { getDefaultBucket, listObjects, putObject } from '../r2/client.js'
import { parseBinanceCliArgs, concurrencyFlag } from './cliArgs.js'
import {
  aggTradesDayDir,
  aggTradesDayPath,
  aggTradesR2Key,
  aggTradesR2Prefix,
  isoDateFromAggTradesFilename,
} from './paths.js'

/**
 * Producer-side mirror: upload converted Binance aggTrades day files from
 * `data/binance/aggTrades/<PAIR>/` to R2 under the identical key layout
 * (`binance/aggTrades/<PAIR>/...`). Day files are immutable in the normal
 * flow, so skip-if-exists (by R2 prefix listing) is the sync protocol — but
 * the skip also compares sizes: a locally regenerated file (converter fix,
 * `--force` re-download) whose size differs from the R2 copy is re-uploaded,
 * so a stale mirror can't silently outlive a data fix.
 *
 * Daily producer routine (e.g. cron on the data machine):
 *   npm run binance:download-aggtrades -- --pair BTCUSDT --sync
 *   npm run binance:upload-aggtrades-r2 -- --pair BTCUSDT
 * Workers then pull with binance:download-aggtrades-r2-to-local.
 */

type Args = { pair: string; concurrency: number; force: boolean; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  let concurrency = 4
  let force = false
  let dryRun = false
  const { pair } = parseBinanceCliArgs({
    argv,
    usage:
      'Usage: npm run binance:upload-aggtrades-r2 -- --pair BTCUSDT [--concurrency 4] [--force] [--dry-run]',
    flags: {
      '--concurrency': concurrencyFlag(4, (n) => (concurrency = n)),
      '--force': { kind: 'boolean', set: () => (force = true) },
      '--dry-run': { kind: 'boolean', set: () => (dryRun = true) },
    },
  })
  return { pair, concurrency, force, dryRun }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'binance:upload-r2' })
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()

  const localDir = aggTradesDayDir(args.pair)
  const localDates: string[] = []
  try {
    for (const n of await fs.readdir(localDir)) {
      const d = isoDateFromAggTradesFilename(n, args.pair)
      if (d) localDates.push(d)
    }
  } catch {
    console.error(`[binance:upload-r2] no local directory: ${localDir}`)
    process.exit(2)
  }
  localDates.sort()

  const r2SizeByKey = new Map(
    (await listObjects(bucket, aggTradesR2Prefix(args.pair))).map((o) => [o.key, o.size]),
  )

  const toUpload: string[] = []
  let sizeDrift = 0
  for (const d of localDates) {
    if (args.force) {
      toUpload.push(d)
      continue
    }
    const remoteSize = r2SizeByKey.get(aggTradesR2Key(args.pair, d))
    if (remoteSize === undefined) {
      toUpload.push(d)
      continue
    }
    const localSize = (await fs.stat(aggTradesDayPath(args.pair, d))).size
    if (localSize !== remoteSize) {
      sizeDrift++
      console.warn(
        `[binance:upload-r2] ${args.pair} ${d}: size drift (local=${localSize} r2=${remoteSize}) — re-uploading (local file regenerated?)`,
      )
      toUpload.push(d)
    }
  }

  console.log(
    `[binance:upload-r2] pair=${args.pair} bucket=${bucket} local=${localDates.length} on-r2=${r2SizeByKey.size} to-upload=${toUpload.length}` +
      (sizeDrift > 0 ? ` (size-drift=${sizeDrift})` : '') +
      (args.force ? ' force' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (args.dryRun || toUpload.length === 0) return

  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(`[binance:upload-r2] ${sig} — finishing in-flight uploads, then stopping`)
      aborted = true
    },
  })

  let uploaded = 0
  let totalBytes = 0

  const fatal = await runWorkerPool({
    jobs: toUpload,
    concurrency: args.concurrency,
    isAborted: () => aborted,
    run: async (date) => {
      const body = await fs.readFile(aggTradesDayPath(args.pair, date))
      // Content-MD5 → R2 validates the payload server-side before accepting.
      const contentMD5 = crypto.createHash('md5').update(body).digest('base64')
      await putObject(bucket, aggTradesR2Key(args.pair, date), body, { contentMD5 })
      uploaded++
      totalBytes += body.length
      console.log(
        `[binance:upload-r2] ${args.pair} ${date}: ${fmtBytes(body.length)} (${uploaded}/${toUpload.length})`,
      )
    },
  })

  if (fatal) {
    console.error('[binance:upload-r2] fatal:', fatal.message)
    process.exit(1)
  }
  console.log(
    `[binance:upload-r2] done: uploaded=${uploaded} total=${fmtBytes(totalBytes)}` +
      (aborted ? ' (aborted early)' : ''),
  )
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[binance:upload-r2] fatal:', err)
  process.exit(1)
})
