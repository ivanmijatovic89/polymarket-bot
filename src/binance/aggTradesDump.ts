import { promises as fs, createWriteStream, createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { sleep } from '../utils/sleep.js'
import { fileExists } from '../utils/fs.js'
import { getInMemoryDuckDb, sqlQuote } from '../utils/duckdb.js'
import { aggTradesDayPath, aggTradesDumpUrl, tmpDir } from './paths.js'

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000]

export class DumpNotFoundError extends Error {
  constructor(url: string) {
    super(`404 not found: ${url}`)
    this.name = 'DumpNotFoundError'
  }
}

/** Streaming HTTP download to `destPath` with bounded retries. 404 throws DumpNotFoundError immediately. */
async function downloadToFile(url: string, destPath: string): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 404) throw new DumpNotFoundError(url)
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
      await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath))
      return
    } catch (err) {
      await fs.rm(destPath, { force: true }).catch(() => {})
      if (err instanceof DumpNotFoundError) throw err
      lastErr = err
      if (attempt < MAX_RETRIES) {
        console.warn(
          `[binance:download] retry ${attempt}/${MAX_RETRIES} ${url}: ${err instanceof Error ? err.message : String(err)}`,
        )
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4000)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function sha256OfFile(p: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(createReadStream(p), hash)
  return hash.digest('hex')
}

/** Extract the single CSV entry of a Binance dump zip to `destCsvPath`. */
function extractSingleCsv(zipPath: string, destCsvPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('yauzl.open returned no zipfile'))
      let found = false
      // yauzl auto-closes on its own 'error'/'end' paths, but not when WE
      // reject (openReadStream error, pipeline failure) — close explicitly so
      // no zip fd leaks to callers that catch and continue.
      const fail = (e: unknown): void => {
        try {
          zipfile.close()
        } catch {
          // already closed
        }
        reject(e instanceof Error ? e : new Error(String(e)))
      }
      zipfile.on('error', reject)
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (found || !entry.fileName.toLowerCase().endsWith('.csv')) {
          zipfile.readEntry()
          return
        }
        found = true
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            return fail(streamErr ?? new Error('yauzl.openReadStream returned no stream'))
          }
          pipeline(readStream, createWriteStream(destCsvPath))
            .then(() => {
              zipfile.close()
              resolve()
            })
            .catch(fail)
        })
      })
      zipfile.on('end', () => {
        if (!found) reject(new Error(`no .csv entry inside ${zipPath}`))
      })
      zipfile.readEntry()
    })
  })
}

/** Sniff whether the first CSV line is a header row (non-numeric first field). */
async function csvHasHeader(csvPath: string): Promise<boolean> {
  const fh = await fs.open(csvPath, 'r')
  try {
    const buf = Buffer.alloc(256)
    const { bytesRead } = await fh.read(buf, 0, 256, 0)
    const firstLine = buf.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? ''
    const firstField = firstLine.split(',')[0]?.trim() ?? ''
    return firstField.length > 0 && !/^\d+$/.test(firstField)
  } finally {
    await fh.close()
  }
}

export type DownloadDayResult = {
  status: 'downloaded' | 'skipped-exists' | 'skipped-not-published'
  parquetPath: string
  rows?: number
  bytes?: number
}

/**
 * Download + convert one (pair, UTC date) daily aggTrades dump to its canonical
 * parquet path. Idempotent: skips when the final parquet already exists (unless
 * `force`). Atomic: converts into `<final>.<pid>.tmp` then renames.
 *
 * Output schema (ordered by agg_trade_id):
 *   agg_trade_id BIGINT, price DOUBLE, qty DOUBLE, first_trade_id BIGINT,
 *   last_trade_id BIGINT, ts_ms BIGINT, is_buyer_maker BOOLEAN
 *
 * `ts_ms` is normalized to milliseconds: daily spot dumps switched to
 * microsecond timestamps on 2025-01-01; floor(µs/1000) equals the live WS `T`.
 * `price DOUBLE` reproduces the live client's `Number(agg.p)` bit-for-bit
 * (same IEEE-754 parse of the same decimal string).
 */
export async function downloadAggTradesDay(args: {
  pair: string
  isoDate: string
  force?: boolean
  keepZip?: boolean
}): Promise<DownloadDayResult> {
  const finalPath = aggTradesDayPath(args.pair, args.isoDate)
  if (!args.force && (await fileExists(finalPath))) {
    return { status: 'skipped-exists', parquetPath: finalPath }
  }

  const urls = aggTradesDumpUrl(args.pair, args.isoDate)
  const scratch = tmpDir()
  await fs.mkdir(scratch, { recursive: true })
  await fs.mkdir(path.dirname(finalPath), { recursive: true })

  const base = `${args.pair}-aggTrades-${args.isoDate}.${process.pid}`
  const zipPath = path.join(scratch, `${base}.zip`)
  const checksumPath = path.join(scratch, `${base}.CHECKSUM`)
  const csvPath = path.join(scratch, `${base}.csv`)
  const tmpParquet = `${finalPath}.${process.pid}.tmp`

  const cleanup = async (): Promise<void> => {
    if (!args.keepZip) await fs.rm(zipPath, { force: true }).catch(() => {})
    await fs.rm(checksumPath, { force: true }).catch(() => {})
    await fs.rm(csvPath, { force: true }).catch(() => {})
    await fs.rm(tmpParquet, { force: true }).catch(() => {})
  }

  try {
    // Both fetches map a 404 to skipped-not-published: during Binance's daily
    // publication window the zip can appear minutes before its .CHECKSUM, and
    // that transient state must skip the day (retried by the next --sync run),
    // not abort the whole pool run.
    try {
      await downloadToFile(urls.zip, zipPath)
      await downloadToFile(urls.checksum, checksumPath)
    } catch (err) {
      if (err instanceof DumpNotFoundError) {
        return { status: 'skipped-not-published', parquetPath: finalPath }
      }
      throw err
    }

    const expected = (await fs.readFile(checksumPath, 'utf8')).trim().split(/\s+/)[0]?.toLowerCase()
    const actual = await sha256OfFile(zipPath)
    if (!expected || expected !== actual) {
      throw new Error(
        `[binance:download] sha256 mismatch for ${urls.zip}: expected=${expected} actual=${actual}`,
      )
    }

    await extractSingleCsv(zipPath, csvPath)
    const header = await csvHasHeader(csvPath)

    const db = await getInMemoryDuckDb()
    const conn = await db.connect()
    try {
      const readCsv =
        `read_csv(${sqlQuote(csvPath)}, header=${header ? 'true' : 'false'}, ` +
        `columns={'agg_trade_id':'BIGINT','price':'DOUBLE','qty':'DOUBLE',` +
        `'first_trade_id':'BIGINT','last_trade_id':'BIGINT','transact_time':'BIGINT',` +
        `'is_buyer_maker':'BOOLEAN','is_best_match':'BOOLEAN'})`
      // µs→ms normalization: post-2025 daily files carry microsecond timestamps.
      // DISTINCT: rare Binance dump artifact — some daily files contain a
      // duplicated block of full-row-identical rows (seen: BTCUSDT 2026-02-11,
      // 2000 rows). Dedupe so agg ids stay unique.
      await conn.run(
        `COPY (
           SELECT DISTINCT
             agg_trade_id,
             price,
             qty,
             first_trade_id,
             last_trade_id,
             CASE WHEN transact_time > 10000000000000 THEN transact_time // 1000 ELSE transact_time END AS ts_ms,
             is_buyer_maker
           FROM ${readCsv}
           ORDER BY agg_trade_id
         ) TO ${sqlQuote(tmpParquet)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
      )
      const countRes = await conn.run(`SELECT count(*) FROM read_parquet(${sqlQuote(tmpParquet)})`)
      const rows = Number(countRes.getChunk(0).getRows()[0]?.[0] ?? 0)
      await fs.rename(tmpParquet, finalPath)
      const bytes = (await fs.stat(finalPath)).size
      return { status: 'downloaded', parquetPath: finalPath, rows, bytes }
    } finally {
      conn.closeSync()
    }
  } finally {
    await cleanup()
  }
}
