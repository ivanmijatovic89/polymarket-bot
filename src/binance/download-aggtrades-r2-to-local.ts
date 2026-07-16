import '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { getDefaultBucket, getObjectToFile, listObjects } from '../r2/client.js'
import { aggTradesDayPath, isoDateFromAggTradesFilename, pairFromFeedSymbol } from './paths.js'

/**
 * Worker-side pull: download every Binance aggTrades day file from the R2
 * mirror (`binance/aggTrades/<PAIR>/`) that is missing locally, to the
 * canonical local path the backtest feed loader reads. Atomic tmp→rename,
 * skip-if-exists (files are immutable). Run before backtests / on a cron.
 *
 *   npm run binance:download-aggtrades-r2-to-local -- --pair BTCUSDT [--concurrency 6] [--dry-run] [--force]
 *
 * The feed loader itself never falls back to R2 — a missing file is a hard
 * per-market error by design (auditable data pipeline, no silent network).
 */

type Args = { pair: string; concurrency: number; force: boolean; dryRun: boolean }

function parseArgs(argv: string[]): Args {
  let pair = ''
  let concurrency = 6
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
    else if (a === '--concurrency') concurrency = Math.max(1, Number(next()) || 6)
    else if (a === '--force') force = true
    else if (a === '--dry-run') dryRun = true
    else {
      console.error(
        'Usage: npm run binance:download-aggtrades-r2-to-local -- --pair BTCUSDT [--concurrency 6] [--force] [--dry-run]',
      )
      process.exit(2)
    }
  }
  if (!pair) {
    console.error('Usage: npm run binance:download-aggtrades-r2-to-local -- --pair BTCUSDT')
    process.exit(2)
  }
  return { pair, concurrency, force, dryRun }
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
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'binance:r2-to-local' })
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()

  const prefix = `binance/aggTrades/${args.pair}/`
  const remote = (await listObjects(bucket, prefix))
    .map((o) => ({ ...o, date: isoDateFromAggTradesFilename(o.key) }))
    .filter((o): o is { key: string; size: number; date: string } => o.date !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const jobs: Array<{ key: string; size: number; date: string; localPath: string }> = []
  let onLocal = 0
  for (const o of remote) {
    const localPath = aggTradesDayPath(args.pair, o.date)
    if (!args.force && (await fileExists(localPath))) onLocal++
    else jobs.push({ ...o, localPath })
  }

  console.log(
    `[binance:r2-to-local] pair=${args.pair} bucket=${bucket} on-r2=${remote.length} on-local=${onLocal} to-download=${jobs.length}` +
      (args.force ? ' force' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (args.dryRun || jobs.length === 0) return

  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(`[binance:r2-to-local] ${sig} — finishing in-flight downloads, then stopping`)
      aborted = true
    },
  })

  const queue = [...jobs]
  let downloaded = 0
  let totalBytes = 0
  let fatal: Error | undefined

  const worker = async (): Promise<void> => {
    while (!aborted && !fatal) {
      const job = queue.shift()
      if (!job) return
      const tmp = `${job.localPath}.${process.pid}.tmp`
      try {
        await fs.mkdir(path.dirname(job.localPath), { recursive: true })
        await getObjectToFile(bucket, job.key, tmp)
        await fs.rename(tmp, job.localPath)
        downloaded++
        totalBytes += job.size
        console.log(
          `[binance:r2-to-local] ${args.pair} ${job.date}: ${fmtBytes(job.size)} (${downloaded}/${jobs.length})`,
        )
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        fatal = err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, queue.length) }, worker))

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
