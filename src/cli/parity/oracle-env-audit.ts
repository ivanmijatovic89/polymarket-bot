import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ORACLE_ENV_KEYS, REPO_ROOT } from '../../backtest/parity/cell.js'
import { parseArgv } from '../../backtest/parity/cliArgs.js'
import {
  ORACLE_ENV_ALLOWLIST_FILE,
  auditEnvReads,
  listSourceFiles,
  parseEnvAllowlist,
  readEnginePaths,
  scanEnvReads,
} from '../../backtest/parity/oracle.js'

const USAGE = `Usage:
  npm run native:oracle:env-audit [-- --verbose]

Lists every environment read under the engine paths (native/parity/engine-paths.txt,
60 OR-2) and fails when one is neither an OR-7 knob (pinned by run-parity) nor in
native/parity/oracle-env-allowlist.txt as result-neutral (60 OR-7). Runs at every
oracle sync and before every gating run.`

function main(): number {
  const p = parseArgv(process.argv.slice(2), { values: [], switches: ['verbose', 'help'] })
  if (p.switches.has('help')) {
    console.log(USAGE)
    return 0
  }
  const paths = readEnginePaths()
  const files = listSourceFiles([...paths.engine, ...paths.inputFormat])
  const reads = files.flatMap((f) => scanEnvReads(f, readFileSync(path.join(REPO_ROOT, f), 'utf8')))
  const allow = parseEnvAllowlist(readFileSync(ORACLE_ENV_ALLOWLIST_FILE, 'utf8'))
  const res = auditEnvReads(reads, ORACLE_ENV_KEYS, allow)
  const names = [...new Set(reads.map((r) => r.name ?? '<dynamic>'))].sort()
  console.log(`[env-audit] ${files.length} files, ${reads.length} env reads, ${names.length} names`)
  if (p.switches.has('verbose'))
    for (const r of reads) console.log(`  ${r.file}:${r.line} ${r.name ?? '<dynamic>'}`)
  for (const v of res.violations)
    console.log(
      `VIOLATION ${v.file}:${v.line} ${v.name ?? 'dynamic process.env[...] outside an allowlisted helper'}: ${v.text}`,
    )
  const unusedAllow = [...allow.vars.keys()].filter((n) => !reads.some((r) => r.name === n))
  for (const n of unusedAllow)
    console.log(`note: allowlisted ${n} is not read under the engine paths any more`)
  console.log(
    res.violations.length === 0
      ? '[env-audit] OK'
      : `[env-audit] ${res.violations.length} violation(s)`,
  )
  return res.violations.length === 0 ? 0 : 1
}

process.exitCode = main()
