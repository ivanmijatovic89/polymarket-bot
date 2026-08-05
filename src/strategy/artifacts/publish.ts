import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { insertStrategyArtifactIfMissing } from '../../db/strategyArtifacts.js'
import { getDefaultBucket, headObject, putObject } from '../../r2/client.js'
import { formatR2Url } from '../../r2/parseR2Url.js'
import { sha256OfBuffer } from '../../utils/hash.js'
import { strategyRegistry } from '../strategyRegistry.js'
import { buildStrategyArtifact } from './bundle.js'
import { typecheckExternalRepo } from './externalRepoCheck.js'
import { artifactCachePath, ensureArtifactLoaded } from './loader.js'
import { ARTIFACT_FORMAT_VERSION, artifactR2Key } from './types.js'

/**
 * The publish pipeline as a reusable routine: build → hash → prime local
 * cache → import-validate → upload once (skip-if-exists) → provenance row.
 * Shared by the `strategy:publish` CLI and by `--strategy-file` (backtest /
 * trade:bot auto-publish). Idempotent: same source ⇒ same sha ⇒ upload and
 * insert are no-ops. Throws `PublishError` on every failure — no fallback.
 */

export class PublishError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublishError'
  }
}

export type PublishResult = {
  sha256: string
  r2Url: string
  strategyId: string
  sizeBytes: number
  sourceCommit: string
  sourceDirty: boolean
  alreadyPublished: boolean
}

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export async function publishStrategyArtifactFromSource(args: {
  /** Absolute path to the external strategy repo (must be a git repo). */
  repoDir: string
  /** Entrypoint exporting `definition`, relative to repoDir. */
  entrypoint: string
  /** Publish from a dirty tree (recorded in provenance). Default false. */
  allowDirty?: boolean
  /** Skip the typecheck pre-flight. Default false. */
  skipChecks?: boolean
  /** Build + validate only; no upload, no DB row. Default false. */
  dryRun?: boolean
  log?: (msg: string) => void
}): Promise<PublishResult> {
  const log = args.log ?? ((msg: string) => console.log(msg))
  const repoDir = path.resolve(args.repoDir)

  const entryAbs = path.resolve(repoDir, args.entrypoint)
  if (path.relative(repoDir, entryAbs).startsWith('..')) {
    // An escaping entrypoint would record provenance (repo, commit) that does
    // not actually contain the published code.
    throw new PublishError(`entrypoint must stay inside the repo: ${args.entrypoint}`)
  }
  await fs.access(entryAbs).catch(() => {
    throw new PublishError(`entrypoint not found: ${entryAbs}`)
  })

  // --- source provenance -----------------------------------------------------
  let commit: string
  let dirty: boolean
  try {
    commit = git(repoDir, ['rev-parse', 'HEAD'])
    dirty = git(repoDir, ['status', '--porcelain']) !== ''
  } catch {
    throw new PublishError(`${repoDir} is not a git repository with at least one commit`)
  }
  if (dirty && !args.allowDirty) {
    throw new PublishError(
      'repo has uncommitted changes — commit first, or pass --allow-dirty (recorded in provenance)',
    )
  }
  let sourceRepo: string
  try {
    sourceRepo = git(repoDir, ['remote', 'get-url', 'origin'])
  } catch {
    sourceRepo = repoDir // no remote — record the absolute path
  }
  // Engine root derived from this file's location, NOT cwd: a direct tsx run
  // from inside another git repo must not record that repo's HEAD.
  const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  let engineCommit = 'unknown'
  try {
    engineCommit = git(engineRoot, ['rev-parse', 'HEAD'])
  } catch {
    /* engine checkout without git — provenance only */
  }

  // --- pre-flight typecheck --------------------------------------------------
  if (!args.skipChecks) {
    log(`[strategy:publish] typecheck pre-flight (engine src/ + ${repoDir})`)
    if (!typecheckExternalRepo({ repoDir })) {
      throw new PublishError('typecheck FAILED — fix errors or pass --skip-checks')
    }
  }

  // --- build -----------------------------------------------------------------
  log(
    `[strategy:publish] bundling ${args.entrypoint} (commit ${commit.slice(0, 12)}${dirty ? ', DIRTY' : ''})`,
  )
  const built = await buildStrategyArtifact({
    repoDir,
    entrypoint: args.entrypoint,
    source: { repo: sourceRepo, commit, dirty },
  }).catch((err: unknown) => {
    // esbuild rejections (incl. allowlist violations from the rewrite plugin)
    // carry the full diagnostics in message — surface them as PublishError so
    // callers get consistent classification/exit codes.
    throw new PublishError(`bundle failed: ${err instanceof Error ? err.message : String(err)}`)
  })
  const sha256 = sha256OfBuffer(built.bytes)

  // --- prime local cache + import-validate ----------------------------------
  const cachePath = artifactCachePath(sha256)
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  const tmp = `${cachePath}.${process.pid}.tmp`
  await fs.writeFile(tmp, built.bytes)
  await fs.rename(tmp, cachePath)

  const r2Key = artifactR2Key(sha256)
  const bucket = args.dryRun ? 'dry-run' : getDefaultBucket()
  const r2Url = formatR2Url(bucket, r2Key)
  const def = await (async () => {
    try {
      const loaded = await ensureArtifactLoaded({ sha256, r2Url })
      if (!loaded.id) throw new PublishError('artifact definition has an empty id')
      if (strategyRegistry[loaded.id]) {
        throw new PublishError(
          `strategy id ${JSON.stringify(loaded.id)} collides with a registry strategy — rename the external strategy id`,
        )
      }
      return loaded
    } catch (err) {
      // Don't leave a primed cache file behind for an artifact that was never
      // published (unreferenced by DB or R2).
      await fs.unlink(cachePath).catch(() => {})
      throw err
    }
  })()
  log(
    `[strategy:publish] built ${def.id}  sha256=${sha256}  (${(built.bytes.length / 1024).toFixed(1)} KB)`,
  )

  const base = {
    sha256,
    r2Url,
    strategyId: def.id,
    sizeBytes: built.bytes.length,
    sourceCommit: commit,
    sourceDirty: dirty,
  }
  if (args.dryRun) {
    log('[strategy:publish] --dry-run: skipping upload and DB row')
    return { ...base, alreadyPublished: false }
  }

  // --- upload once (skip-if-exists) -----------------------------------------
  let etag: string | undefined
  let alreadyPublished = false
  const existing = await headObject(bucket, r2Key)
  if (existing) {
    if (existing.size !== built.bytes.length) {
      // Content-addressed keys can never legitimately change size.
      throw new PublishError(
        `r2://${bucket}/${r2Key} exists with ${existing.size} bytes but the build produced ${built.bytes.length} — refusing to overwrite`,
      )
    }
    alreadyPublished = true
    log(`[strategy:publish] already published: ${r2Url}`)
  } else {
    const contentMD5 = (await import('node:crypto'))
      .createHash('md5')
      .update(built.bytes)
      .digest('base64')
    etag = (await putObject(bucket, r2Key, built.bytes, { contentMD5 })).etag
    log(`[strategy:publish] uploaded ${r2Url}`)
  }

  // --- provenance row --------------------------------------------------------
  const { inserted } = await insertStrategyArtifactIfMissing({
    sha256,
    strategyId: def.id,
    entrypoint: args.entrypoint,
    sourceRepo,
    sourceCommit: commit,
    sourceDirty: dirty,
    engineCommit,
    formatVersion: ARTIFACT_FORMAT_VERSION,
    builtWith: built.builtWith,
    r2Url,
    sizeBytes: built.bytes.length,
    etag: etag ?? null,
    builtAt: new Date(),
  })
  log(
    inserted
      ? '[strategy:publish] provenance row inserted'
      : '[strategy:publish] provenance row already present',
  )
  return { ...base, alreadyPublished }
}
