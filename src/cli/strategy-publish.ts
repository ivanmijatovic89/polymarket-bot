/**
 * Publish an external-repo strategy as an immutable content-addressed
 * artifact (issue #211; see docs/strategy/external-artifacts.md).
 *
 *   npm run strategy:publish -- --repo /path/to/repo --entrypoint strategies/my-strat.v1.ts
 *
 * Flags:
 *   --repo <dir>          external strategy repo (git repository)
 *   --entrypoint <rel>    file exporting `definition`, relative to --repo
 *   --allow-dirty         publish from a dirty working tree (recorded in provenance)
 *   --skip-checks         skip the typecheck pre-flight
 *   --dry-run             build + validate only; no upload, no DB row
 *
 * Publish is idempotent: same source ⇒ same sha ⇒ upload and DB insert are
 * skipped. Params are never part of the artifact.
 */
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { closeDb } from '../db/index.js'
import { insertStrategyArtifactIfMissing } from '../db/strategyArtifacts.js'
import { getDefaultBucket, headObject, putObject } from '../r2/client.js'
import { formatR2Url } from '../r2/parseR2Url.js'
import { buildStrategyArtifact } from '../strategy/artifacts/bundle.js'
import { typecheckExternalRepo } from '../strategy/artifacts/externalRepoCheck.js'
import { artifactCachePath, ensureArtifactLoaded } from '../strategy/artifacts/loader.js'
import { ARTIFACT_FORMAT_VERSION, artifactR2Key } from '../strategy/artifacts/types.js'
import { strategyRegistry } from '../strategy/strategyRegistry.js'
import { sha256OfBuffer } from '../utils/hash.js'

type Args = {
  repo: string
  entrypoint: string
  allowDirty: boolean
  skipChecks: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  let repo: string | null = null
  let entrypoint: string | null = null
  let allowDirty = false
  let skipChecks = false
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--repo') repo = argv[++i] ?? null
    else if (arg.startsWith('--repo=')) repo = arg.slice('--repo='.length)
    else if (arg === '--entrypoint') entrypoint = argv[++i] ?? null
    else if (arg.startsWith('--entrypoint=')) entrypoint = arg.slice('--entrypoint='.length)
    else if (arg === '--allow-dirty') allowDirty = true
    else if (arg === '--skip-checks') skipChecks = true
    else if (arg === '--dry-run') dryRun = true
    else {
      console.error(`[strategy:publish] unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  if (!repo || !entrypoint) {
    console.error(
      'usage: npm run strategy:publish -- --repo <dir> --entrypoint <rel.ts> [--allow-dirty] [--skip-checks] [--dry-run]',
    )
    process.exit(2)
  }
  if (path.isAbsolute(entrypoint)) {
    console.error('[strategy:publish] --entrypoint must be relative to --repo')
    process.exit(2)
  }
  return { repo: path.resolve(repo), entrypoint, allowDirty, skipChecks, dryRun }
}

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], // stderr captured, not leaked to the console
  }).trim()
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const entryAbs = path.join(args.repo, args.entrypoint)
  await fs.access(entryAbs).catch(() => {
    console.error(`[strategy:publish] entrypoint not found: ${entryAbs}`)
    process.exit(2)
  })

  // --- source provenance -----------------------------------------------------
  let commit: string
  let dirty: boolean
  try {
    commit = git(args.repo, ['rev-parse', 'HEAD'])
    dirty = git(args.repo, ['status', '--porcelain']) !== ''
  } catch {
    console.error(
      `[strategy:publish] ${args.repo} is not a git repository with at least one commit`,
    )
    process.exit(2)
  }
  if (dirty && !args.allowDirty) {
    console.error(
      '[strategy:publish] external repo has uncommitted changes — commit first, or pass --allow-dirty (recorded in provenance)',
    )
    process.exit(2)
  }
  let sourceRepo: string
  try {
    sourceRepo = git(args.repo, ['remote', 'get-url', 'origin'])
  } catch {
    sourceRepo = args.repo // no remote — record the absolute path
  }
  let engineCommit = 'unknown'
  try {
    engineCommit = git(process.cwd(), ['rev-parse', 'HEAD'])
  } catch {
    /* engine checkout without git — provenance only */
  }

  // --- pre-flight typecheck --------------------------------------------------
  if (!args.skipChecks) {
    console.log(`[strategy:publish] typecheck pre-flight (engine src/ + ${args.repo})`)
    if (!typecheckExternalRepo({ repoDir: args.repo })) {
      console.error('[strategy:publish] typecheck FAILED — fix errors or pass --skip-checks')
      process.exit(1)
    }
  }

  // --- build -----------------------------------------------------------------
  console.log(
    `[strategy:publish] bundling ${args.entrypoint} (commit ${commit.slice(0, 12)}${dirty ? ', DIRTY' : ''})`,
  )
  const built = await buildStrategyArtifact({
    repoDir: args.repo,
    entrypoint: args.entrypoint,
    source: { repo: sourceRepo, commit, dirty },
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
  const def = await ensureArtifactLoaded({ sha256, r2Url })
  if (!def.id) {
    console.error('[strategy:publish] artifact definition has an empty id')
    process.exit(1)
  }
  if (strategyRegistry[def.id]) {
    console.error(
      `[strategy:publish] strategy id ${JSON.stringify(def.id)} collides with a registry strategy — rename the external strategy id`,
    )
    process.exit(1)
  }
  console.log(
    `[strategy:publish] built ${def.id}  sha256=${sha256}  (${(built.bytes.length / 1024).toFixed(1)} KB)`,
  )

  if (args.dryRun) {
    console.log('[strategy:publish] --dry-run: skipping upload and DB row')
    return
  }

  // --- upload once (skip-if-exists) -----------------------------------------
  let etag: string | undefined
  const existing = await headObject(bucket, r2Key)
  if (existing) {
    if (existing.size !== built.bytes.length) {
      // Content-addressed keys can never legitimately change size.
      console.error(
        `[strategy:publish] r2://${bucket}/${r2Key} exists with ${existing.size} bytes but the build produced ${built.bytes.length} — refusing to overwrite`,
      )
      process.exit(1)
    }
    console.log(`[strategy:publish] already published: ${r2Url}`)
  } else {
    const contentMD5 = (await import('node:crypto'))
      .createHash('md5')
      .update(built.bytes)
      .digest('base64')
    etag = (await putObject(bucket, r2Key, built.bytes, { contentMD5 })).etag
    console.log(`[strategy:publish] uploaded ${r2Url}`)
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
  console.log(
    inserted
      ? '[strategy:publish] provenance row inserted'
      : '[strategy:publish] provenance row already present',
  )

  console.log('\nRun it:')
  console.log(`  npm run backtest -- --strategy-artifact ${sha256} --param key=value ...`)
  console.log(`  npm run trade:bot -- --strategy-artifact ${sha256}`)
}

main()
  .then(async () => {
    await closeDb().catch(() => {})
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('[strategy:publish]', err instanceof Error ? err.message : err)
    await closeDb().catch(() => {})
    process.exit(1)
  })
