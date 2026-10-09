import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, linkSync, mkdirSync, renameSync, rmSync } from 'node:fs'
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

export const TRACE_CACHE_KEY_VERSION = 2

/** Host-specific variables that never change results; excluded from the key. */
const HOST_ENV = new Set(['PATH', 'HOME'])

/** Parity files whose content shapes TS trace bytes: the writer and the child runner. */
export const TRACE_WRITER_FILES = [
  'src/backtest/parity/trace.ts',
  'src/backtest/parity/runJob.ts',
  'src/cli/parity/ts-trace.ts',
] as const

/** Tooling outside the trace writer, and the TS twins (keyed separately), excluded from the engine trees. */
const KEY_EXCLUDED_PREFIXES = [
  'src/backtest/parity/',
  'src/cli/parity/',
  'scripts/parity/',
  'src/strategies/testing/',
]

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim()
}

/** Hash of a path's blob listing at a commit, without parity tooling and test files. */
function filteredTreeHash(commit: string, p: string): string {
  const lines = git(['ls-tree', '-r', commit, '--', p])
    .split('\n')
    .filter((l) => {
      const file = l.slice(l.indexOf('\t') + 1)
      return (
        l !== '' &&
        !file.endsWith('.test.ts') &&
        !KEY_EXCLUDED_PREFIXES.some((x) => file.startsWith(x))
      )
    })
  return sha256Hex(lines.join('\n'))
}

/**
 * OR-12 tree component of the key: the engine paths (and src/strategies) at
 * `engineCommit` without the parity tooling, plus the trace writer files and
 * the TS twins at `toolingCommit` (the pin tree takes them from this
 * checkout, OR-17). A tooling change that cannot alter TS trace bytes keeps
 * the cache valid.
 */
// D-PENDING: OR-12 keys on "git tree hashes of the engine paths at the pin"; chose the trees of the commit whose sources run (HEAD, or the pin for --oracle-tree pin) minus the parity tooling, plus the trace-writer files and src/strategies/testing at the tooling commit, and no caching on a dirty working tree.
export function cacheTreeHashes(
  paths: EnginePaths,
  engineCommit = 'HEAD',
  toolingCommit = 'HEAD',
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of [...paths.engine, ...paths.inputFormat, 'src/strategies'])
    out[p] = filteredTreeHash(engineCommit, p)
  for (const f of [...TRACE_WRITER_FILES, 'src/strategies/testing'])
    out[f] = git(['rev-parse', `${toolingCommit}:${f}`])
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
  /** Which TS tree ran (`head` or `pin`): OR-17 compares the two, so they never share entries. */
  oracleTree: 'head' | 'pin'
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
      oracleTree: args.oracleTree,
    }),
  )
}

export function cachedTracePath(cacheDir: string, key: string, ext: string): string {
  return path.join(cacheDir, key.slice(0, 2), `${key}.ts${ext}`)
}

/** Hard-link (same file system) or copy `src` to `dest` via a temp name; cached traces are immutable. */
function linkOrCopy(src: string, dest: string): void {
  const tmp = `${dest}.tmp-${process.pid}`
  rmSync(tmp, { force: true })
  try {
    linkSync(src, tmp)
  } catch {
    copyFileSync(src, tmp)
  }
  renameSync(tmp, dest)
}

/** Put a cached trace in place; true on a hit. */
export function restoreFromCache(
  cacheDir: string,
  key: string,
  ext: string,
  dest: string,
): boolean {
  const src = cachedTracePath(cacheDir, key, ext)
  if (!existsSync(src)) return false
  rmSync(dest, { force: true })
  linkOrCopy(src, dest)
  return true
}

/** Store a fresh trace atomically. */
export function storeInCache(cacheDir: string, key: string, ext: string, src: string): void {
  const dest = cachedTracePath(cacheDir, key, ext)
  mkdirSync(path.dirname(dest), { recursive: true })
  linkOrCopy(src, dest)
}
