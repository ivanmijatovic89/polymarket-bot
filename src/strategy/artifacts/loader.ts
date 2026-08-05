import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { downloadR2ToLocal } from '../../telonex/fetchConvertedToLocal.js'
import { fileExists } from '../../utils/fs.js'
import { sha256OfFile } from '../../utils/hash.js'
import { isStrategyDefinition } from '../protocolStrategyDiscovery.js'
import type { StrategyDefinition } from '../strategyDefinition.js'
import {
  ARTIFACT_FORMAT_VERSION,
  ARTIFACT_LOCAL_DIR,
  SHA256_HEX_RE,
  isArtifactBanner,
  type StrategyArtifactRef,
} from './types.js'

/**
 * Consumer-side loading of strategy artifacts (backtest workers, the live
 * bot, and the producer itself).
 *
 * Content-addressed and layered:
 *  - disk cache `data/strategy-artifacts/<sha256>.mjs`, one download per
 *    machine (atomic tmp→rename via downloadR2ToLocal, concurrent-safe);
 *  - per-process memo, one import + hash verification per process.
 *
 * The hash is verified BEFORE the first import in every process — a corrupt
 * or tampered cache file can never execute. Every failure path throws with
 * sha + r2Url context; there is deliberately NO fallback to another strategy.
 */

// realpath'd so cache paths stay stable when the checkout is reached through a
// symlink (matches bundle.ts's engine-root handling).
const REPO_ROOT = (() => {
  const resolved = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
})()

/**
 * Cache directory override for tests. MUST stay under the repo root —
 * `#pmb/*` and `zod` inside an artifact resolve via the root package.json.
 */
export function artifactCacheDir(): string {
  const override = process.env.STRATEGY_ARTIFACT_CACHE_DIR?.trim()
  return override ? path.resolve(REPO_ROOT, override) : path.join(REPO_ROOT, ARTIFACT_LOCAL_DIR)
}

export function artifactCachePath(sha256: string): string {
  return path.join(artifactCacheDir(), `${sha256}.mjs`)
}

export class ArtifactIntegrityError extends Error {
  constructor(args: { expected: string; actual: string; source: string }) {
    super(
      `[artifact] content hash mismatch for ${args.source}: expected sha256=${args.expected}, got ${args.actual} — corrupt file removed, will re-download on retry`,
    )
    this.name = 'ArtifactIntegrityError'
  }
}

export class ArtifactShapeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ArtifactShapeError'
  }
}

const loadedArtifacts = new Map<string, Promise<StrategyDefinition<unknown>>>()

/**
 * Resolve an artifact ref to its StrategyDefinition, downloading and
 * verifying as needed. Memoized per process per sha; a rejected load is
 * evicted so a BullMQ retry gets a fresh attempt (e.g. transient R2 failure).
 */
export function ensureArtifactLoaded(
  ref: StrategyArtifactRef,
): Promise<StrategyDefinition<unknown>> {
  const existing = loadedArtifacts.get(ref.sha256)
  if (existing) return existing
  const promise = loadArtifact(ref)
  loadedArtifacts.set(ref.sha256, promise)
  promise.catch(() => loadedArtifacts.delete(ref.sha256))
  return promise
}

async function loadArtifact(ref: StrategyArtifactRef): Promise<StrategyDefinition<unknown>> {
  if (!SHA256_HEX_RE.test(ref.sha256)) {
    throw new ArtifactShapeError(
      `[artifact] invalid sha256 ${JSON.stringify(ref.sha256)} (expected 64 lowercase hex chars)`,
    )
  }
  const cachePath = artifactCachePath(ref.sha256)
  if (!(await fileExists(cachePath))) {
    await downloadR2ToLocal(ref.r2Url, cachePath)
  }
  const actual = await sha256OfFile(cachePath)
  if (actual !== ref.sha256) {
    await fs.unlink(cachePath).catch(() => {})
    throw new ArtifactIntegrityError({
      expected: ref.sha256,
      actual,
      source: `${cachePath} (${ref.r2Url})`,
    })
  }
  let mod: Record<string, unknown>
  try {
    mod = (await import(pathToFileURL(cachePath).href)) as Record<string, unknown>
  } catch (err) {
    // Keep sha + r2Url context like every other failure path in this file —
    // a bare import error (e.g. engine API drift) is otherwise untraceable.
    // `cause` preserves the original stack (in-bundle frames) for debugging.
    throw new ArtifactShapeError(
      `[artifact] ${ref.sha256.slice(0, 12)} failed to import: ${err instanceof Error ? err.message : String(err)} (${ref.r2Url})`,
      { cause: err },
    )
  }
  const banner = mod.__pmbArtifact
  if (!isArtifactBanner(banner)) {
    throw new ArtifactShapeError(
      `[artifact] ${ref.sha256.slice(0, 12)} has no valid __pmbArtifact banner — not a strategy artifact (${ref.r2Url})`,
    )
  }
  if (banner.formatVersion !== ARTIFACT_FORMAT_VERSION) {
    throw new ArtifactShapeError(
      `[artifact] ${ref.sha256.slice(0, 12)} has format version ${banner.formatVersion}, this engine supports ${ARTIFACT_FORMAT_VERSION} — republish the strategy`,
    )
  }
  const def = mod.definition
  if (!isStrategyDefinition(def)) {
    throw new ArtifactShapeError(
      `[artifact] ${ref.sha256.slice(0, 12)} exports \`definition\` but it is not a valid StrategyDefinition (${ref.r2Url})`,
    )
  }
  return def
}
