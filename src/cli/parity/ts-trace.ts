import { readFileSync } from 'node:fs'
import type { MarketJobData } from '../../backtest/jobTypes.js'
import { one, parseArgv } from '../../backtest/parity/cliArgs.js'
import { runJobToTraceFile } from '../../backtest/parity/runJob.js'
import type { TraceLevel } from '../../backtest/parity/trace.js'

const USAGE = `Usage:
  npx tsx scripts/parity/ts-trace.ts --job <MarketJobData.json> --out <trace.jsonl[.gz]> --level decisions|feeds [--quiet]

Runs ONE market job through the TypeScript engine exactly as a backtest worker
does and writes the canonical parity trace pmb-parity-trace/2
(native/spec/22-trace-ledger-journal.md §3). run-parity spawns this with the
pinned oracle environment (60 OR-7); run it directly only for debugging.`

async function main(): Promise<number> {
  const p = parseArgv(process.argv.slice(2), {
    values: ['job', 'out', 'level'],
    switches: ['quiet', 'help'],
  })
  if (p.switches.has('help')) {
    console.log(USAGE)
    return 0
  }
  const jobFile = one(p, 'job')
  const out = one(p, 'out')
  const level = one(p, 'level')
  if (!jobFile || !out || (level !== 'decisions' && level !== 'feeds'))
    throw new Error(`missing or invalid --job/--out/--level\n\n${USAGE}`)
  if (p.positionals.length > 0) throw new Error(`unexpected arguments: ${p.positionals.join(' ')}`)
  const job = JSON.parse(readFileSync(jobFile, 'utf8')) as MarketJobData
  const startedAt = Date.now()
  const { output, summary: s } = await runJobToTraceFile(job, out, {
    level: level as TraceLevel,
    profile: 'ts-compat',
    quiet: p.switches.has('quiet'),
  })
  console.error(
    `[ts-trace] ${job.slug} strategy=${job.strategyId} ticks=${s.ticks} synthetic=${s.syntheticTicks} ` +
      `intents=${JSON.stringify(s.intents)} events=${JSON.stringify(s.events)} ` +
      `pnl=${output.marketStats ? output.marketStats.pnl : 'n/a'} skip=${output.skipReason ?? '-'} ` +
      `in ${((Date.now() - startedAt) / 1000).toFixed(1)}s -> ${out}`,
  )
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    console.error(`[ts-trace] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    process.exitCode = 1
  })
