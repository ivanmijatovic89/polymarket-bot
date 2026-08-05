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
 * Identity = sha256 of the bundle bytes, and the bytes are derived from CODE
 * ONLY (plus the entrypoint path relative to the repo root): no git commit,
 * dirty flag, remote URL, or timestamp is embedded, so the same code produces
 * the same sha across commits and machines. Params are NOT part of the
 * artifact: many runs with different `--param` sets reference the same sha.
 * Git provenance (repo, commit, dirty) lives in the `strategy_artifacts` DB
 * row and in `backtest_runs.strategy_artifact_meta` — recorded at the FIRST
 * publish of that exact code.
 */

/** Bump when the bundle contract changes incompatibly (banner shape, externals model). */
export const ARTIFACT_FORMAT_VERSION = 2

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
 * Reproducibility metadata persisted alongside a run
 * (`backtest_runs.strategy_artifact_meta`) and carried in aggregate-job
 * insertMeta. Single shared shape — do not re-declare it inline.
 */
export type StrategyArtifactMeta = {
  r2Url: string
  sourceRepo: string
  sourceCommit: string
  sourceDirty: boolean
  entrypoint: string
}

/**
 * Embedded in every bundle as `export const __pmbArtifact`. Deliberately
 * contains NOTHING machine- or git-dependent (no commit, dirty flag, repo
 * URL, or timestamp) — the banner is part of the hashed bytes, so anything
 * here would fork the sha for identical code. Git provenance lives in the DB
 * row / run meta instead. The strategy id is NOT duplicated here —
 * `definition.id` is the source of truth.
 */
export type ArtifactBanner = {
  formatVersion: number
  /** Entrypoint path relative to the repo root — part of the code identity. */
  entrypoint: string
}

export function isArtifactBanner(x: unknown): x is ArtifactBanner {
  if (typeof x !== 'object' || x === null) return false
  const b = x as Partial<ArtifactBanner>
  return typeof b.formatVersion === 'number' && typeof b.entrypoint === 'string'
}
