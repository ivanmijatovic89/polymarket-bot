import { parseArgv } from '../../backtest/parity/cliArgs.js'
import { compareTsTraces, readManifest } from '../../backtest/parity/manifest.js'

const USAGE = `Usage:
  npx tsx scripts/parity/self-parity.ts <manifest A> <manifest B>

TS self-parity (native/spec/60-verification.md OR-17): compares the TS trace
sha256 per market of two run-parity manifests of the same cell, typically one
with --oracle-tree head and one with --oracle-tree pin. Exit 0 only when every
market's TS trace is byte-identical on both sides.`

function main(): number {
  const p = parseArgv(process.argv.slice(2), { values: [], switches: ['help'] })
  if (p.switches.has('help') || p.positionals.length !== 2) {
    console.error(USAGE)
    return p.switches.has('help') ? 0 : 2
  }
  const [fa, fb] = p.positionals as [string, string]
  const a = readManifest(fa)
  const b = readManifest(fb)
  if (a.cell.sha256 !== b.cell.sha256)
    throw new Error('the manifests come from different cell files')
  const rows = compareTsTraces(a, b)
  for (const r of rows.filter((x) => !x.identical))
    console.log(`DIFFERENT ${r.slug}: ${r.a ?? 'missing'} vs ${r.b ?? 'missing'}`)
  const same = rows.filter((r) => r.identical).length
  console.log(
    `[self-parity] ${a.cell.name}: ${same}/${rows.length} byte-identical TS traces (A tree=${a.oracle.tree}, B tree=${b.oracle.tree})`,
  )
  return same === rows.length && rows.length > 0 ? 0 : 1
}

try {
  process.exitCode = main()
} catch (err) {
  console.error(`[self-parity] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 2
}
