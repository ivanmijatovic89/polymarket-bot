/**
 * Renders the absolute-path `EngineJob` of a committed fixture market
 * (native/spec/60 §12 FX-1a, 21 §5.1) and prints the file path, so the M1
 * proof can run `J=$(npm run -s native:fixture-job -- <slug>)`.
 *
 *   npm run -s native:fixture-job -- <slug> [--out <file>] [--strategy-id <id>]
 *       [--params '<json object>'] [--feeds none]
 *
 * Every input file is checked against fixture.json (bytes and sha256) before
 * the job is written. `--feeds none` renders the job for a strategy that
 * requests no feeds: no `gammaPriceToBeat`, `feedAvailability.priceToBeat`
 * null and no `feedFiles` (14 §6.2). The default output path is
 * `<os tmpdir>/pmb-fixture-jobs/<slug>-<sha256 prefix of the job>.json`.
 * No database, network or env access.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JOB_FILE, fixtureDir, jsonText, readManifest, verifyFixtureFiles } from './fixtures-lib.js'

type Job = {
  run: { strategyId: string; candidates: Array<{ params: Record<string, unknown> }> }
  market: {
    gammaPriceToBeat?: unknown
    feedAvailability: { priceToBeat: unknown }
    input: { path: string; bytes: number; sha256: string | null }
    feedFiles: Array<{ path: string; bytes: number }>
  }
}

const USAGE =
  'usage: fixture-job.ts <slug> [--out <file>] [--strategy-id <id>] [--params <json>] [--feeds none]'

function parseArgs(argv: string[]): {
  slug: string
  out?: string
  strategyId?: string
  params?: Record<string, unknown>
  noFeeds: boolean
} {
  const [slug, ...rest] = argv
  if (!slug || slug.startsWith('--')) throw new Error(USAGE)
  const parsed: ReturnType<typeof parseArgs> = { slug, noFeeds: false }
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]!
    const value = rest[i + 1]
    if (value === undefined) throw new Error(`missing value for ${name}\n${USAGE}`)
    if (name === '--out') parsed.out = path.resolve(value)
    else if (name === '--strategy-id') parsed.strategyId = value
    else if (name === '--params') {
      const p = JSON.parse(value) as unknown
      if (typeof p !== 'object' || p === null || Array.isArray(p)) {
        throw new Error('--params must be a JSON object')
      }
      parsed.params = p as Record<string, unknown>
    } else if (name === '--feeds') {
      if (value !== 'none') throw new Error('--feeds accepts only "none"')
      parsed.noFeeds = true
    } else throw new Error(`unknown flag ${name}\n${USAGE}`)
  }
  return parsed
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const dir = fixtureDir(args.slug)
  const manifest = readManifest(args.slug)
  await verifyFixtureFiles(args.slug, manifest)
  const job = JSON.parse(readFileSync(path.join(dir, JOB_FILE), 'utf8')) as Job

  // The job's own entries must match the manifest (bytes, and sha256 for the input).
  const byPath = new Map(manifest.files.map((f) => [f.path, f]))
  const input = byPath.get(job.market.input.path)
  if (
    !input ||
    input.bytes !== job.market.input.bytes ||
    input.sha256 !== job.market.input.sha256
  ) {
    throw new Error(`${args.slug}: job.json input entry disagrees with fixture.json`)
  }
  for (const f of job.market.feedFiles) {
    if (byPath.get(f.path)?.bytes !== f.bytes) {
      throw new Error(`${args.slug}: job.json feed file ${f.path} disagrees with fixture.json`)
    }
  }

  job.market.input.path = path.resolve(dir, job.market.input.path)
  job.market.feedFiles = job.market.feedFiles.map((f) => ({
    ...f,
    path: path.resolve(dir, f.path),
  }))
  if (args.noFeeds) {
    delete job.market.gammaPriceToBeat
    job.market.feedAvailability.priceToBeat = null
    job.market.feedFiles = []
  }
  if (args.strategyId !== undefined) job.run.strategyId = args.strategyId
  if (args.params !== undefined) {
    if (job.run.candidates.length !== 1) throw new Error('--params needs exactly one candidate')
    job.run.candidates[0]!.params = args.params
  }

  const text = jsonText(job)
  const out =
    args.out ??
    path.join(
      os.tmpdir(),
      'pmb-fixture-jobs',
      `${args.slug}-${createHash('sha256').update(text).digest('hex').slice(0, 16)}.json`,
    )
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(`${out}.tmp`, text)
  renameSync(`${out}.tmp`, out)
  process.stdout.write(`${out}\n`)
}

await main()
