/**
 * `npm run native:fixture-job -- <slug>` (60 §12 FX-1a; 01 §6 M1 proof):
 * renders the committed fixture job `native/fixtures/markets/<slug>/job.json`
 * (fixture-relative paths) into the absolute-path `EngineJob` that 21 §5.1
 * requires, checks it through src/native (generated schema, whole-object
 * ModelConfig validation, input and day-file integrity, 21 §9 steps 2-3),
 * writes it atomically and prints its path, so the proof can run
 * `J=$(npm run -s native:fixture-job -- <slug>)`. No database, network or
 * env access.
 */
import { createHash } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { absolutizeJobPaths, assertEngineJob, verifyJobFiles } from './buildEngineJob.js'
import type { EngineJob, TraceLevel } from './contract/generated.js'
import { REPO_ROOT, validateModelConfig } from './modelConfig.js'

/** Committed fixture markets (60 §12 FX-1). */
export const FIXTURE_MARKETS_DIR = path.join(REPO_ROOT, 'native', 'fixtures', 'markets')

export const FIXTURE_JOB_USAGE =
  'usage: native:fixture-job -- <fixture slug> [--out <file>] [--trace-level decisions|feeds] [--fixtures-root <dir>]'

export interface FixtureJobArgs {
  slug: string
  out?: string
  traceLevel?: TraceLevel
  fixturesRoot?: string
}

/** Parses the CLI; unknown flags and repeated flags are errors (R14). */
export function parseFixtureJobArgs(argv: string[]): FixtureJobArgs {
  const [slug, ...rest] = argv
  if (!slug || slug.startsWith('--')) throw new Error(FIXTURE_JOB_USAGE)
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`invalid fixture slug ${JSON.stringify(slug)}`)
  const seen = new Map<string, string>()
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]!
    const value = rest[i + 1]
    if (!['--out', '--trace-level', '--fixtures-root'].includes(name)) {
      throw new Error(`unknown argument ${name}\n${FIXTURE_JOB_USAGE}`)
    }
    if (seen.has(name)) throw new Error(`${name} given twice`)
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${name}`)
    seen.set(name, value)
  }
  const level = seen.get('--trace-level')
  if (level !== undefined && level !== 'decisions' && level !== 'feeds') {
    throw new Error(`--trace-level ${level}: expected decisions or feeds`)
  }
  const out = seen.get('--out')
  const root = seen.get('--fixtures-root')
  return {
    slug,
    ...(out === undefined ? {} : { out: path.resolve(out) }),
    ...(level === undefined ? {} : { traceLevel: level }),
    ...(root === undefined ? {} : { fixturesRoot: path.resolve(root) }),
  }
}

/**
 * The absolute-path, verified `EngineJob` of a fixture market. The job's
 * `outputs.traceLevel` may be set (non-semantic, 21 §5); everything else is
 * the committed job.
 */
export async function renderFixtureJob(args: FixtureJobArgs): Promise<EngineJob> {
  const dir = path.join(args.fixturesRoot ?? FIXTURE_MARKETS_DIR, args.slug)
  const file = path.join(dir, 'job.json')
  if (!existsSync(file)) throw new Error(`no fixture job ${file} (60 §12 FX-1)`)
  const committed = JSON.parse(readFileSync(file, 'utf8')) as unknown
  assertEngineJob(committed)
  if (committed.market.slug !== args.slug) {
    throw new Error(`${file}: market.slug ${committed.market.slug} != ${args.slug}`)
  }
  validateModelConfig(committed.run.modelConfig)
  const job = absolutizeJobPaths(committed, dir)
  if (args.traceLevel !== undefined) job.outputs = { ...job.outputs, traceLevel: args.traceLevel }
  await verifyJobFiles(job)
  assertEngineJob(job)
  return job
}

/** Writes the rendered job atomically and returns its path. */
export async function writeFixtureJob(args: FixtureJobArgs): Promise<string> {
  const job = await renderFixtureJob(args)
  const text = `${JSON.stringify(job, null, 2)}\n`
  const out =
    args.out ??
    path.join(
      os.tmpdir(),
      'pmb-fixture-jobs',
      `${args.slug}-${createHash('sha256').update(text).digest('hex').slice(0, 16)}.json`,
    )
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(`${out}.tmp`, text)
  await fs.rename(`${out}.tmp`, out)
  return out
}

/** CLI entry: prints the written job's path on stdout and nothing else. */
export async function fixtureJobMain(argv: string[]): Promise<void> {
  const out = await writeFixtureJob(parseFixtureJobArgs(argv))
  process.stdout.write(`${out}\n`)
}
