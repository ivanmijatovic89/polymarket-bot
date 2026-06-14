import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getObjectToFile } from '../r2/client.js'
import { parseR2Url } from '../r2/parseR2Url.js'

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [1000, 2000, 4000]

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** True if `p` exists (any stat success). Shared so callers don't each re-roll it. */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

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
 * Throws if all retries are exhausted (callers decide how to surface it).
 */
export async function downloadR2ToLocal(
  r2Url: string,
  absolutePath: string,
): Promise<{ bytes: number }> {
  const { bucket, key } = parseR2Url(r2Url)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  const tmp = `${absolutePath}.${process.pid}.tmp`
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await getObjectToFile(bucket, key, tmp)
      await fs.rename(tmp, absolutePath)
      let bytes = 0
      try {
        bytes = (await fs.stat(absolutePath)).size
      } catch {
        // size is best-effort
      }
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
