<<<<<<< HEAD
/**
 * Renders the absolute-path `EngineJob` of a committed fixture market
 * (native/spec/60 §12 FX-1a, 21 §5.1) and prints the file path, so the M1
 * proof can run `J=$(npm run -s native:fixture-job -- <slug>)`.
 *
 *   npm run -s native:fixture-job -- <slug> [--out <file>]
 *       [--strategy-id <id> --feeds none|all|<binance,chainlink,price-to-beat>]
 *       [--params '<json object>']
 *
 * Default: the committed job.json, i.e. the engine exerciser
 * (`engine-exerciser.rs`, no params) in the no-feeds form of the producer
 * contract: no `gammaPriceToBeat`, `feedAvailability.priceToBeat` null and no
 * `feedFiles` (14 §6.2, 21 §5.1; the exerciser requests no feeds, 60 §5.1).
 * `--strategy-id` with another strategy requires an explicit `--feeds`: the
 * job then carries `gammaPriceToBeat` and `feedAvailability.priceToBeat` when
 * price-to-beat is requested, and the fixture's day files of each requested
 * feed (all from fixture.json). `--feeds` other than `none` is refused for
 * the engine exerciser.
 *
 * Before writing, every fixture file is checked against fixture.json (bytes
 * and sha256; feed day files carry no sha256 in the job, 14 §4.1, so this is
 * where theirs is checked) and the committed job.json must equal the job
 * rendered from fixture.json. The default output path is
 * `<os tmpdir>/pmb-fixture-jobs/<slug>-<sha256 prefix of the job>.json`.
 * No database, network or env access.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_STRATEGY_ID,
  JOB_FILE,
  NO_FEEDS,
  NO_FEED_STRATEGY_IDS,
  committedJob,
  fixtureDir,
  jsonText,
  parseFeeds,
  readManifest,
  readModelConfig,
  renderJob,
  sha256Text,
  verifyFixtureFiles,
  type FeedSelection,
} from './fixtures-lib.js'

const USAGE =
  'usage: fixture-job.ts <slug> [--out <file>] [--strategy-id <id> --feeds none|all|<list>] [--params <json>]'

type Args = {
  slug: string
  out: string | undefined
  strategyId: string
  params: Record<string, unknown>
  feeds: FeedSelection
}

export function parseArgs(argv: string[]): Args {
  const [slug, ...rest] = argv
  if (!slug || slug.startsWith('--')) throw new Error(USAGE)
  const seen = new Map<string, string>()
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]!
    const value = rest[i + 1]
    if (!['--out', '--strategy-id', '--params', '--feeds'].includes(name)) {
      throw new Error(`unknown argument ${name}\n${USAGE}`)
    }
    if (seen.has(name)) throw new Error(`${name} given twice`)
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${name}`)
    seen.set(name, value)
  }
  let params: Record<string, unknown> = {}
  const rawParams = seen.get('--params')
  if (rawParams !== undefined) {
    const p = JSON.parse(rawParams) as unknown
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      throw new Error('--params must be a JSON object')
    }
    params = p as Record<string, unknown>
  }
  const strategyId = seen.get('--strategy-id') ?? DEFAULT_STRATEGY_ID
  const rawFeeds = seen.get('--feeds')
  if (rawFeeds === undefined && !NO_FEED_STRATEGY_IDS.has(strategyId)) {
    throw new Error(
      `--strategy-id ${strategyId} needs an explicit --feeds (the feeds that strategy requests)`,
    )
  }
  const out = seen.get('--out')
  return {
    slug,
    out: out === undefined ? undefined : path.resolve(out),
    strategyId,
    params,
    feeds: rawFeeds === undefined ? { ...NO_FEEDS } : parseFeeds(rawFeeds),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const dir = fixtureDir(args.slug)
  const manifest = readManifest(args.slug)
  await verifyFixtureFiles(args.slug, manifest)
  const committed = JSON.parse(readFileSync(path.join(dir, JOB_FILE), 'utf8')) as unknown
  if (jsonText(committed) !== jsonText(committedJob(manifest))) {
    throw new Error(
      `${args.slug}: ${JOB_FILE} differs from the job rendered from fixture.json (run \`npm run native:fixtures:build -- jobs\`)`,
    )
  }
  const job = renderJob(manifest, {
    strategyId: args.strategyId,
    params: args.params,
    feeds: args.feeds,
    baseDir: dir,
    modelConfig: readModelConfig(),
  })
  const slug = (job.market as { slug?: unknown }).slug
  if (slug !== args.slug) throw new Error(`rendered job slug ${String(slug)} != ${args.slug}`)

  const text = jsonText(job)
  const out =
    args.out ??
    path.join(os.tmpdir(), 'pmb-fixture-jobs', `${args.slug}-${sha256Text(text).slice(0, 16)}.json`)
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(`${out}.tmp`, text)
  renameSync(`${out}.tmp`, out)
  process.stdout.write(`${out}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main()
}
=======
// Entry point of `npm run native:fixture-job -- <fixture slug>` (60 §12 FX-1a,
// 01 §6 M1 proof); the logic lives in src/native/fixtureJob.ts so CI
// typechecks and lints it.
import { fixtureJobMain } from '../../src/native/fixtureJob.js'

fixtureJobMain(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`[native:fixture-job] ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 2
})
>>>>>>> ws/ts
