/**
 * External strategy artifacts — shared types and constants.
 *
 * An artifact is a single self-contained ESM `.mjs` bundle of a strategy whose
 * source of truth lives OUTSIDE this repository (see issue #211 and
 * docs/strategy/external-artifacts.md). The bundle contains the external
 * repo's own files and npm deps; engine modules and `zod` are left as
 * `#pmb/*` / bare references filled by the running machine's local checkout
 * (root package.json `imports` field).
 *
 * Identity = sha256 of the bundle bytes. Params are NOT part of the artifact:
 * many runs with different `--param` sets reference the same sha. A new sha
 * exists only when the strategy code changes.
 */

/** Bump when the bundle contract changes incompatibly (banner shape, externals model). */
export const ARTIFACT_FORMAT_VERSION = 1

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/** R2 key + canonical local cache path share this layout (path-mirroring convention). */
export const ARTIFACT_R2_PREFIX = 'strategy-artifacts'
export const ARTIFACT_LOCAL_DIR = 'data/strategy-artifacts'

export function artifactR2Key(sha256: string): string {
  return `${ARTIFACT_R2_PREFIX}/${sha256}.mjs`
}

/**
 * The minimal immutable reference a consumer needs to load an artifact.
 * This is what backtest market jobs carry — workers stay DB-free.
 */
export type StrategyArtifactRef = {
  sha256: string
  r2Url: string
}

/**
 * Embedded in every bundle as `export const __pmbArtifact`. Deliberately
 * timestamp-free: the same source must always produce byte-identical bundles
 * (deterministic sha). Build-time metadata lives in the DB row instead. The
 * strategy id is NOT duplicated here — `definition.id` is the source of truth.
 */
export type ArtifactBanner = {
  formatVersion: number
  source: {
    repo: string
    commit: string
    dirty: boolean
    entrypoint: string
  }
}

export function isArtifactBanner(x: unknown): x is ArtifactBanner {
  if (typeof x !== 'object' || x === null) return false
  const b = x as Partial<ArtifactBanner>
  return (
    typeof b.formatVersion === 'number' &&
    typeof b.source === 'object' &&
    b.source !== null &&
    typeof b.source.repo === 'string' &&
    typeof b.source.commit === 'string' &&
    typeof b.source.dirty === 'boolean' &&
    typeof b.source.entrypoint === 'string'
  )
}
