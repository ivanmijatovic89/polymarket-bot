import '../../config/env.js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { closeDb } from '../../db/index.js'
import type { MarketJobData } from '../../backtest/jobTypes.js'
import { one, parseArgv } from '../../backtest/parity/cliArgs.js'
import {
  DEFAULT_DATA_ROOT,
  buildParityJobs,
  resolveParityStrategy,
  stageArtifact,
  useDataRoot,
} from '../../backtest/parity/marketJob.js'
import { runJobWithTrace } from '../../backtest/parity/runJob.js'
import { writeTrace } from '../../backtest/parity/trace.js'
import { summarizeTrace } from '../../backtest/parity/diff.js'
import { JOB_VALUE_FLAGS, jobOptionsFromArgv } from './common.js'

const USAGE = `Usage (run from the repo/worktree root):
  npx tsx scripts/parity/ts-trace.ts --slug <slug> (--strategy <id> | --strategy-artifact <sha256> | --params-from-run <id>)
      [--param k=v ...] [--latency-delay-ms 0] [--latency-jitter-ms 0] [--starting-capital <usdc>]
      [--read-from local|r2] [--data-root ${DEFAULT_DATA_ROOT}]
      [--out trace.jsonl[.gz]] [--job-out job.json] [--no-run] [--quiet]
  npx tsx scripts/parity/ts-trace.ts --job job.json --out trace.jsonl[.gz] [--data-root …] [--quiet]

Runs ONE telonex-delta market through the TypeScript engine exactly as a backtest
worker would and writes the canonical parity trace (native/TRACE.md).`

async function main(): Promise<void> {
  const p = parseArgv(process.argv.slice(2), {
    values: [...JOB_VALUE_FLAGS, 'slug', 'job', 'out', 'job-out'],
    switches: ['no-run', 'quiet', 'help'],
  })
  if (p.switches.has('help')) {
    console.log(USAGE)
    return
  }
  const dataRoot = one(p, 'data-root') ?? DEFAULT_DATA_ROOT
  useDataRoot(dataRoot)

  let job: MarketJobData
  const jobFile = one(p, 'job')
  if (jobFile) {
    job = JSON.parse(readFileSync(jobFile, 'utf8')) as MarketJobData
  } else {
    const slug = one(p, 'slug')
    if (!slug) throw new Error(`missing --slug or --job\n\n${USAGE}`)
    const opts = await jobOptionsFromArgv(p)
    const built = await resolveParityStrategy(opts.selection, opts.dataRoot)
    const { jobs, missing } = await buildParityJobs({
      slugs: [slug],
      built,
      latency: opts.latency,
      startingCapital: opts.startingCapital,
      readFrom: opts.readFrom,
      dataRoot: opts.dataRoot,
    })
    if (missing.length > 0 || !jobs[0])
      throw new Error(
        `slug ${slug} is not an eligible telonex-delta market (read-from=${opts.readFrom}, strategy feeds considered)`,
      )
    job = jobs[0]
  }
  await closeDb()

  const jobOut = one(p, 'job-out')
  if (jobOut) {
    mkdirSync(path.dirname(path.resolve(jobOut)), { recursive: true })
    writeFileSync(jobOut, JSON.stringify(job, null, 2) + '\n')
    console.error(`[ts-trace] job → ${jobOut}`)
  }
  if (p.switches.has('no-run')) return

  if (job.strategyArtifact) stageArtifact(job.strategyArtifact.sha256, dataRoot)
  const out = one(p, 'out') ?? `${job.slug ?? `market-${job.idx}`}.ts.jsonl`
  const startedAt = Date.now()
  const { output, recorder } = await runJobWithTrace(job, { quiet: p.switches.has('quiet') })
  writeTrace(out, recorder.records)
  const s = summarizeTrace(recorder.records)
  const stats = output.marketStats
  console.error(
    `[ts-trace] ${job.slug} strategy=${job.strategyId} latency=${job.latency.delayMs}/${job.latency.jitterMs} ` +
      `ticks=${s.ticks} intents=${JSON.stringify(s.intents)} events=${JSON.stringify(s.events)} ` +
      `pnl=${stats ? stats.pnl : 'n/a'} skip=${output.skipReason ?? '-'} ` +
      `in ${((Date.now() - startedAt) / 1000).toFixed(1)}s → ${out}`,
  )
}

main().catch(async (err: unknown) => {
  console.error(`[ts-trace] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  await closeDb().catch(() => {})
  process.exit(1)
})
