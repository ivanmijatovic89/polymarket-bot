import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import type { MarketJobData } from '../jobTypes.js'
import { REPO_ROOT, canonicalJsonLoose, sha256Hex } from './cell.js'
import type { FileIdentity } from './manifest.js'
import { type EnginePaths } from './oracle.js'

/**
 * TS trace cache (native/spec/60-verification.md OR-12, HR-4, VP-4): the key
 * is (git tree hashes of the engine paths, job sha256, input file identities,
 * oracleEnv sha256, patch-set sha256), so unchanged trees reuse traces and
 * changed trees invalidate exactly the affected ones.
 */

export const TRACE_CACHE_KEY_VERSION = 1

/** Host-specific variables that never change results; excluded from the key. */
const HOST_ENV = new Set(['PATH', 'HOME'])

// D-PENDING: OR-12 keys on the engine-path trees "at the pin"; chose the trees at HEAD (equal to the pin outside the allowlisted files, and the trace writer itself is an allowlisted engine-path file) plus src/strategies (the TS twins live outside the engine paths, OR-4), and no caching on a dirty working tree.
export function cacheTreeHashes(paths: EnginePaths): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of [...paths.engine, ...paths.inputFormat, 'src/strategies'])
    out[p] = execFileSync('git', ['rev-parse', `HEAD:${p}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()
  return out
}

/** Job sha256 without provenance-only fields (`commitSha`, D12; batch and submission labels stay, they name the candidate). */
// D-PENDING: OR-12 says "job sha256"; chose to drop `commitSha` (provenance only, D12) so a new commit with identical trees reuses traces.
export function jobKeySha256(job: MarketJobData): string {
  const { commitSha: _commitSha, ...rest } = job
  void _commitSha
  return sha256Hex(canonicalJsonLoose(rest))
}

export function traceCacheKey(args: {
  trees: Record<string, string>
  job: MarketJobData
  inputs: { market: FileIdentity | null; feedFiles: FileIdentity[] }
  oracleEnv: Record<string, string>
  traceLevel: string
  patchSetSha256: string | null
}): string {
  const env = Object.fromEntries(Object.entries(args.oracleEnv).filter(([k]) => !HOST_ENV.has(k)))
  const identity = (f: FileIdentity | null) => (f ? { bytes: f.bytes, sha256: f.sha256 } : null)
  return sha256Hex(
    canonicalJsonLoose({
      v: TRACE_CACHE_KEY_VERSION,
      trees: args.trees,
      job: jobKeySha256(args.job),
      inputs: {
        market: identity(args.inputs.market),
        feedFiles: args.inputs.feedFiles.map(identity),
      },
      oracleEnv: sha256Hex(canonicalJsonLoose(env)),
      traceLevel: args.traceLevel,
      patchSet: args.patchSetSha256,
    }),
  )
}

export function cachedTracePath(cacheDir: string, key: string, ext: string): string {
  return path.join(cacheDir, key.slice(0, 2), `${key}.ts${ext}`)
}

/** Copy a cached trace into place; true on a hit. */
export function restoreFromCache(
  cacheDir: string,
  key: string,
  ext: string,
  dest: string,
): boolean {
  const src = cachedTracePath(cacheDir, key, ext)
  if (!existsSync(src)) return false
  copyFileSync(src, dest)
  return true
}

/** Store a fresh trace atomically (tmp → rename). */
export function storeInCache(cacheDir: string, key: string, ext: string, src: string): void {
  const dest = cachedTracePath(cacheDir, key, ext)
  mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp-${process.pid}`
  copyFileSync(src, tmp)
  renameSync(tmp, dest)
}
