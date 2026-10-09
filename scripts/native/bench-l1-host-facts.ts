// Records this host's core, cache, memory, OS and toolchain facts
// (16 §2.3, M1 step 7) into
// `native/bench/results/m1-host-facts-<yyyymmdd>-<host>.md`.
//
//   npm run native:bench:host-facts [-- --host worker-1 --date 20261009 --force]
//
// Read-only on the host: `sysctl`, `pmset -g`, `rustc`/`cargo --version`.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { collectHostFacts, renderHostFactsMarkdown } from '../../native/bench/harness/hostFacts.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function localDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** `cores_for_backtest` of this host in the dashboard machine table, if listed. */
function coresForBacktest(host: string): number | null {
  const file = path.join(REPO_ROOT, 'dashboard/src/data/machines.json')
  if (!fs.existsSync(file)) return null
  const table = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
    string,
    { name?: string; cores_for_backtest?: number }
  >
  const entry = Object.values(table).find((m) => m.name === host)
  return typeof entry?.cores_for_backtest === 'number' ? entry.cores_for_backtest : null
}

function main(): void {
  if (process.platform !== 'darwin') throw new Error('host facts are read with macOS sysctl keys')
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      host: { type: 'string' },
      date: { type: 'string' },
      'out-dir': { type: 'string', default: path.join(REPO_ROOT, 'native/bench/results') },
      force: { type: 'boolean', default: false },
    },
  })
  const date = values.date ?? localDate(new Date())
  if (!/^[0-9]{8}$/.test(date)) throw new Error('--date must be yyyymmdd')
  const run = (cmd: string, args: readonly string[]): string =>
    execFileSync(cmd, args, { cwd: path.join(REPO_ROOT, 'native'), encoding: 'utf8' })
  const facts = collectHostFacts(run, {
    ...(values.host !== undefined ? { host: values.host } : {}),
    hostname: os.hostname(),
    node: process.versions.node,
  })
  const cfb = coresForBacktest(facts.host)
  const extra = [
    '## Fleet configuration',
    '',
    `- \`cores_for_backtest\` (dashboard/src/data/machines.json): ${cfb ?? 'not listed'}`,
    `- Load average at recording time (1/5/15 min): ${os
      .loadavg()
      .map((l) => l.toFixed(2))
      .join(' / ')}`,
    '',
  ]
  const out = path.join(path.resolve(values['out-dir']), `m1-host-facts-${date}-${facts.host}.md`)
  if (!values.force && fs.existsSync(out)) throw new Error(`${out} exists (use --force to replace)`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(
    out,
    renderHostFactsMarkdown(
      facts,
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`,
      extra,
    ),
  )
  console.log(`wrote ${out}`)
}

main()
