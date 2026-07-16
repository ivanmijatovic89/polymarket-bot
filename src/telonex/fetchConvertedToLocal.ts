import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getObjectToFile } from '../r2/client.js'
import { parseR2Url } from '../r2/parseR2Url.js'
import { sleep } from '../utils/sleep.js'

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000]

// Canonical home is src/utils/fs.ts; re-exported here for existing importers.
export { fileExists } from '../utils/fs.js'

/**
 * Download a converted parquet from R2 to an absolute local path, atomically
 * (`<path>.<pid>.tmp` → rename) with bounded retries; creates parent dirs.
 *
 * SINGLE SOURCE OF TRUTH for the R2→local fetch, shared by
 * `telonex:download-converted-r2-to-local` (bulk pre-fetch) and the backtest
 * `--read-from local-or-download-from-r2-to-local` mode (lazy per-market fetch). The `.tmp` suffix is
 * keyed by pid so concurrent fetchers never collide, and the rename is atomic so
 * an interrupted run never leaves a half-written parquet.
 *
 * When the caller knows the object's size (e.g. from a prior listing), pass
 * `expectedBytes`: a size mismatch on the downloaded tmp file (silently
 * truncated stream) then fails the attempt BEFORE the rename, so a corrupt
 * file can never land on the canonical path that skip-if-exists protects.
 *
 * Throws if all retries are exhausted (callers decide how to surface it).
 */
export async function downloadR2ToLocal(
  r2Url: string,
  absolutePath: string,
  opts?: { expectedBytes?: number },
): Promise<{ bytes: number }> {
  const { bucket, key } = parseR2Url(r2Url)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  const tmp = `${absolutePath}.${process.pid}.tmp`
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await getObjectToFile(bucket, key, tmp)
      const bytes = (await fs.stat(tmp)).size
      if (opts?.expectedBytes !== undefined && bytes !== opts.expectedBytes) {
        throw new Error(
          `[r2-fetch] size mismatch for ${key}: downloaded ${bytes} bytes, expected ${opts.expectedBytes}`,
        )
      }
      await fs.rename(tmp, absolutePath)
      return { bytes }
    } catch (err) {
      lastErr = err
      await fs.rm(tmp, { force: true }).catch(() => {})
      if (attempt < MAX_RETRIES) {
        console.warn(
          `[r2-fetch] retry ${attempt}/${MAX_RETRIES} ${key}: ${err instanceof Error ? err.message : String(err)}`,
        )
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4000)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
