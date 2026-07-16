import '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { getDefaultBucket, listObjects, putObject } from '../r2/client.js'
import {
  aggTradesDayPath,
  aggTradesR2Key,
  isoDateFromAggTradesFilename,
  pairFromFeedSymbol,
} from './paths.js'

/**
 * Producer-side mirror: upload converted Binance aggTrades day files from
 * `data/binance/aggTrades/<PAIR>/` to R2 under the identical key layout
 * (`binance/aggTrades/<PAIR>/...`). Day files are immutable, so skip-if-exists
 * (by R2 prefix listing) is the whole sync protocol — no DB index needed.
 *
 * Daily producer routine (e.g. cron on the data machine):
 *   npm run binance:download-aggtrades -- --pair BTCUSDT --sync
 *   npm run binance:upload-aggtrades-r2 -- --pair BTCUSDT
 * Workers then pull with binance:download-aggtrades-r2-to-local.
 */

type Args = { pair: string; concurrency: number; force: boolean; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  let pair = ''
  let concurrency = 4
  let force = false
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`missing value for ${a}`)
      return v
    }
    if (a === '--pair') pair = pairFromFeedSymbol(next())
    else if (a === '--symbol') pair = pairFromFeedSymbol(`${next()}usdt`)
    else if (a === '--concurrency') concurrency = Math.max(1, Number(next()) || 4)
    else if (a === '--force') force = true
    else if (a === '--dry-run') dryRun = true
    else {
      console.error(
        'Usage: npm run binance:upload-aggtrades-r2 -- --pair BTCUSDT [--concurrency 4] [--force] [--dry-run]',
      )
      process.exit(2)
    }
  }
  if (!pair) {
    console.error('Usage: npm run binance:upload-aggtrades-r2 -- --pair BTCUSDT')
    process.exit(2)
  }
  return { pair, concurrency, force, dryRun }
}

function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'binance:upload-r2' })
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()

  const localDir = path.dirname(aggTradesDayPath(args.pair, '0000-00-00'))
  const localDates: string[] = []
  try {
    for (const n of await fs.readdir(localDir)) {
      const d = isoDateFromAggTradesFilename(n)
      if (d) localDates.push(d)
    }
  } catch {
    console.error(`[binance:upload-r2] no local directory: ${localDir}`)
    process.exit(2)
  }
  localDates.sort()

  const prefix = `binance/aggTrades/${args.pair}/`
  const onR2 = new Set((await listObjects(bucket, prefix)).map((o) => o.key))
  const toUpload = args.force
    ? localDates
    : localDates.filter((d) => !onR2.has(aggTradesR2Key(args.pair, d)))

  console.log(
    `[binance:upload-r2] pair=${args.pair} bucket=${bucket} local=${localDates.length} on-r2=${onR2.size} to-upload=${toUpload.length}` +
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

  const queue = [...toUpload]
  let uploaded = 0
  let totalBytes = 0
  let fatal: Error | undefined

  const worker = async (): Promise<void> => {
    while (!aborted && !fatal) {
      const date = queue.shift()
      if (!date) return
      try {
        const filePath = aggTradesDayPath(args.pair, date)
        const body = await fs.readFile(filePath)
        // Content-MD5 → R2 validates the payload server-side before accepting.
        const contentMD5 = crypto.createHash('md5').update(body).digest('base64')
        await putObject(bucket, aggTradesR2Key(args.pair, date), body, { contentMD5 })
        uploaded++
        totalBytes += body.length
        console.log(
          `[binance:upload-r2] ${args.pair} ${date}: ${fmtBytes(body.length)} (${uploaded}/${toUpload.length})`,
        )
      } catch (err) {
        fatal = err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, queue.length) }, worker))

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
