import { one, parseArgv } from '../../backtest/parity/cliArgs.js'
import { diffTraces } from '../../backtest/parity/diff.js'
import { formatDiff } from '../../backtest/parity/report.js'
import { readTrace, type TraceRecord } from '../../backtest/parity/trace.js'

const USAGE = `Usage:
  npx tsx scripts/parity/diff-traces.ts <a.jsonl[.gz]> <b.jsonl[.gz]> [--context 5] [--json] [--tolerance <x>]

Compares two canonical parity traces under the v2 diff rules
(native/spec/22-trace-ledger-journal.md §3.4). Prints the first divergence
with surrounding context, every field mismatch, auto-class counts and a
per-side summary. --tolerance is for exploration only and marks the result
non-gating. Exit code: 0 equal, 1 mismatch, 2 usage / IO error.`

function main(): number {
  let p
  try {
    p = parseArgv(process.argv.slice(2), {
      values: ['context', 'tolerance'],
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
  const context = Number(one(p, 'context') ?? 5)
  const tolRaw = one(p, 'tolerance')
  const tolerance = tolRaw === undefined ? undefined : Number(tolRaw)
  if (!Number.isInteger(context) || context < 0 || (tolerance !== undefined && !(tolerance >= 0))) {
    console.error(`invalid --context or --tolerance\n\n${USAGE}`)
    return 2
  }
  let a: TraceRecord[], b: TraceRecord[]
  try {
    a = readTrace(fileA)
    b = readTrace(fileB)
  } catch (err) {
    console.error((err as Error).message)
    return 2
  }
  const res = diffTraces(a, b, tolerance !== undefined ? { tolerance } : {})
  if (p.switches.has('json')) console.log(JSON.stringify(res, null, 2))
  else console.log(formatDiff(a, b, res, { a: fileA, b: fileB }, context, tolerance))
  return res.equal ? 0 : 1
}

process.exitCode = main()
