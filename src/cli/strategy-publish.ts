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
 *
 * NOTE: an explicit publish is rarely needed — `--strategy-file <path.ts>`
 * on backtest / trade:bot publishes automatically. This CLI remains for
 * pre-publishing (e.g. CI) and inspection.
 */
import path from 'node:path'
import { closeDb } from '../db/index.js'
import { PublishError, publishStrategyArtifactFromSource } from '../strategy/artifacts/publish.js'

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const result = await publishStrategyArtifactFromSource({
    repoDir: args.repo,
    entrypoint: args.entrypoint,
    allowDirty: args.allowDirty,
    skipChecks: args.skipChecks,
    dryRun: args.dryRun,
  })
  if (!args.dryRun) {
    console.log('\nRun it:')
    console.log(`  npm run backtest -- --strategy-artifact ${result.sha256} --param key=value ...`)
    console.log(`  npm run trade:bot -- --strategy-artifact ${result.sha256}`)
  }
}

main()
  .then(async () => {
    await closeDb().catch(() => {})
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('[strategy:publish]', err instanceof PublishError ? err.message : err)
    await closeDb().catch(() => {})
    process.exit(err instanceof PublishError ? 2 : 1)
  })
