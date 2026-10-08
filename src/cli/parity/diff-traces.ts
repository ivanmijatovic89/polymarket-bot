import { one, parseArgv } from '../../backtest/parity/cliArgs.js'
import { DEFAULT_TOLERANCE, diffTraces } from '../../backtest/parity/diff.js'
import { printDiff } from '../../backtest/parity/report.js'
import { readTrace, type TraceRecord } from '../../backtest/parity/trace.js'

const USAGE = `Usage:
  npx tsx scripts/parity/diff-traces.ts <a.jsonl[.gz]> <b.jsonl[.gz]> [--tolerance 1e-6] [--max-divergences 1] [--context 4] [--json]

Compares two canonical parity traces (native/TRACE.md). Prints the first
divergence with surrounding context plus a per-side summary. Exit code: 0 equal,
1 mismatch, 2 usage / IO error.`

function main(): number {
  let p
  try {
    p = parseArgv(process.argv.slice(2), {
      values: ['tolerance', 'max-divergences', 'context'],
      switches: ['json', 'help'],
    })
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  if (p.switches.has('help') || p.positionals.length !== 2) {
    console.error(USAGE)
    return p.switches.has('help') ? 0 : 2
  }
  const [fileA, fileB] = p.positionals as [string, string]
  const tolerance = Number(one(p, 'tolerance') ?? DEFAULT_TOLERANCE)
  const maxDivergences = Number(one(p, 'max-divergences') ?? 1)
  const context = Number(one(p, 'context') ?? 4)
  let a: TraceRecord[], b: TraceRecord[]
  try {
    a = readTrace(fileA)
    b = readTrace(fileB)
  } catch (err) {
    console.error((err as Error).message)
    return 2
  }
  const res = diffTraces(a, b, { tolerance, maxDivergences })
  if (p.switches.has('json')) console.log(JSON.stringify(res, null, 2))
  else printDiff(a, b, res, { a: fileA, b: fileB }, context, tolerance)
  return res.equal ? 0 : 1
}

process.exitCode = main()
