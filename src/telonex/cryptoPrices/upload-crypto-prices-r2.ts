import '../../config/env.js'
import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'
import { installSignalHandlers, installProcessCrashHandlers } from '../../utils/runtime.js'
import { fmtBytes } from '../../utils/fmtBytes.js'
import { runWorkerPool } from '../../utils/workerPool.js'
import { getDefaultBucket, listObjects, putObject } from '../../r2/client.js'
import { parseCryptoPricesCliArgs, concurrencyFlag } from './cliArgs.js'
import {
  cryptoPricesDayDir,
  cryptoPricesDayPath,
  cryptoPricesR2Key,
  cryptoPricesR2Prefix,
  isoDateFromCryptoPricesFilename,
} from './paths.js'

/**
 * Producer-side mirror: upload Telonex `crypto_prices` day files from
 * `data/telonex/crypto_prices/<asset_id>/` to R2 under the identical key
 * layout. Day files are immutable in the normal flow, so skip-if-exists (by
 * R2 prefix listing) is the sync protocol — but the skip also compares sizes:
 * a locally re-downloaded file whose size differs from the R2 copy is
 * re-uploaded, so a stale mirror can't silently outlive a data fix.
 *
 * Daily producer routine (cron on the data machine):
 *   npm run telonex:crypto-prices:download -- --asset btcusd --sync
 *   npm run telonex:crypto-prices:upload-r2 -- --asset btcusd
 * Workers then pull with telonex:crypto-prices:download-r2-to-local.
 */

type Args = { assetId: string; concurrency: number; force: boolean; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  let concurrency = 4
  let force = false
  let dryRun = false
  const { assetId } = parseCryptoPricesCliArgs({
    argv,
    usage:
      'Usage: npm run telonex:crypto-prices:upload-r2 -- --asset btcusd [--concurrency 4] [--force] [--dry-run]',
    flags: {
      '--concurrency': concurrencyFlag(4, (n) => (concurrency = n)),
      '--force': { kind: 'boolean', set: () => (force = true) },
      '--dry-run': { kind: 'boolean', set: () => (dryRun = true) },
    },
  })
  return { assetId, concurrency, force, dryRun }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'crypto-prices:upload-r2' })
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()

  const localDir = cryptoPricesDayDir(args.assetId)
  const localDates: string[] = []
  try {
    for (const n of await fs.readdir(localDir)) {
      const d = isoDateFromCryptoPricesFilename(n, args.assetId)
      if (d) localDates.push(d)
    }
  } catch {
    console.error(`[crypto-prices:upload-r2] no local directory: ${localDir}`)
    process.exit(2)
  }
  localDates.sort()

  const r2SizeByKey = new Map(
    (await listObjects(bucket, cryptoPricesR2Prefix(args.assetId))).map((o) => [o.key, o.size]),
  )

  const toUpload: string[] = []
  let sizeDrift = 0
  for (const d of localDates) {
    if (args.force) {
      toUpload.push(d)
      continue
    }
    const remoteSize = r2SizeByKey.get(cryptoPricesR2Key(args.assetId, d))
    if (remoteSize === undefined) {
      toUpload.push(d)
      continue
    }
    const localSize = (await fs.stat(cryptoPricesDayPath(args.assetId, d))).size
    if (localSize !== remoteSize) {
      sizeDrift++
      console.warn(
        `[crypto-prices:upload-r2] ${args.assetId} ${d}: size drift (local=${localSize} r2=${remoteSize}) — re-uploading (local file regenerated?)`,
      )
      toUpload.push(d)
    }
  }

  console.log(
    `[crypto-prices:upload-r2] asset=${args.assetId} bucket=${bucket} local=${localDates.length} on-r2=${r2SizeByKey.size} to-upload=${toUpload.length}` +
      (sizeDrift > 0 ? ` (size-drift=${sizeDrift})` : '') +
      (args.force ? ' force' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (args.dryRun || toUpload.length === 0) return

  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(`[crypto-prices:upload-r2] ${sig} — finishing in-flight uploads, then stopping`)
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
      const body = await fs.readFile(cryptoPricesDayPath(args.assetId, date))
      // Content-MD5 → R2 validates the payload server-side before accepting.
      const contentMD5 = crypto.createHash('md5').update(body).digest('base64')
      await putObject(bucket, cryptoPricesR2Key(args.assetId, date), body, { contentMD5 })
      uploaded++
      totalBytes += body.length
      console.log(
        `[crypto-prices:upload-r2] ${args.assetId} ${date}: ${fmtBytes(body.length)} (${uploaded}/${toUpload.length})`,
      )
    },
  })

  if (fatal) {
    console.error('[crypto-prices:upload-r2] fatal:', fatal.message)
    process.exit(1)
  }
  console.log(
    `[crypto-prices:upload-r2] done: uploaded=${uploaded} total=${fmtBytes(totalBytes)}` +
      (aborted ? ' (aborted early)' : ''),
  )
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[crypto-prices:upload-r2] fatal:', err)
  process.exit(1)
})
