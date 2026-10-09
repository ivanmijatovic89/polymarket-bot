import '../../config/env.js'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { closeDb } from '../../db/index.js'
import type { MarketJobData } from '../../backtest/jobTypes.js'
import { DEFAULT_DATA_ROOT, cellStartingCapital, loadCell } from '../../backtest/parity/cell.js'
import { one, parseArgv } from '../../backtest/parity/cliArgs.js'
import { compareJobsH1 } from '../../backtest/parity/harnessValidation.js'
import { buildParityJobs, resolveParityStrategy } from '../../backtest/parity/marketJob.js'

const USAGE = `Usage (from the repository root):
  npx tsx scripts/parity/h1-validate.ts --cell native/parity/cells/<cell>.json --producer-jobs <dir> [--data-root <repo>/data]

H-1 harness validation (native/spec/60-verification.md §4.3): for every
producer MarketJobData JSON in <dir> (jobs the production producer built for
the cell's strategy, params, latency and capital), builds the harness job for
the same slug and compares them with idx, batch and submission fields removed.
Exit 0 only when every market matches and at least 20 markets were compared.`

/** H-1: 20 markets per strategy. */
const H1_MIN_MARKETS = 20

async function main(): Promise<number> {
  const p = parseArgv(process.argv.slice(2), {
    values: ['cell', 'producer-jobs', 'data-root'],
    switches: ['help'],
  })
  if (p.switches.has('help')) {
    console.log(USAGE)
    return 0
  }
  const cellFile = one(p, 'cell')
  const dir = one(p, 'producer-jobs')
  if (!cellFile || !dir) throw new Error(`missing --cell or --producer-jobs\n\n${USAGE}`)
  const cell = loadCell(path.resolve(cellFile))
  const dataRoot = path.resolve(one(p, 'data-root') ?? DEFAULT_DATA_ROOT)
  const producer = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as MarketJobData)
  const built = await resolveParityStrategy(
    'id' in cell.tsStrategy
      ? { strategyId: cell.tsStrategy.id, rawParams: cell.params.values }
      : { artifactSha256: cell.tsStrategy.artifactSha256, rawParams: cell.params.values },
    dataRoot,
  )
  const slugs = producer.map((j) => {
    if (!j.slug) throw new Error('producer job without slug')
    return j.slug
  })
  const { jobs, missing } = await buildParityJobs({
    slugs,
    built,
    latency: {
      delayMs: cell.modelConfig.execution.compatLatency.delayMs,
      jitterMs: cell.modelConfig.execution.compatLatency.jitterMs,
    },
    startingCapital: cellStartingCapital(cell),
    readFrom: cell.readFrom,
    dataRoot,
  })
  await closeDb()
  const harness = new Map(jobs.map((j) => [j.slug!, j] as const))
  let equal = 0
  for (const pj of producer) {
    const hj = harness.get(pj.slug!)
    if (!hj) {
      console.log(`MISSING ${pj.slug}: not eligible for the harness`)
      continue
    }
    const diffs = compareJobsH1(hj, pj, dataRoot)
    if (diffs.length === 0) equal++
    else
      for (const d of diffs.slice(0, 10))
        console.log(
          `DIFF ${pj.slug} ${d.path}: harness=${JSON.stringify(d.harness)} producer=${JSON.stringify(d.producer)}`,
        )
  }
  console.log(
    `[h1] ${cell.cell}: ${equal}/${producer.length} producer jobs equal the harness jobs` +
      (missing.length > 0 ? `; ${missing.length} not eligible` : ''),
  )
  if (producer.length < H1_MIN_MARKETS)
    console.log(`[h1] fewer than ${H1_MIN_MARKETS} markets: not H-1 evidence`)
  return equal === producer.length && producer.length >= H1_MIN_MARKETS ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(async (err: unknown) => {
    console.error(`[h1] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    await closeDb().catch(() => {})
    process.exitCode = 2
  })
