#!/usr/bin/env node
/**
 * fleet-status formatter — reads the JSON collected by
 * ops/ansible/status-workers.yml and prints one aligned table:
 * a row per machine, a column per dataset. Pure inventory — what each
 * machine HAS; what is MISSING is fleet:data:sync --dry-run's answer.
 *
 * Usage: node scripts/fleet-status-format.mjs /tmp/fleet-status.json
 */

import fs from 'node:fs'

const file = process.argv[2] ?? '/tmp/fleet-status.json'
const rows = JSON.parse(fs.readFileSync(file, 'utf8'))

/** newest filename → short date. Converted files carry an epoch suffix, feed day files carry YYYY-MM-DD. */
function newestDate(name) {
  if (name == null) return null
  const day = name.match(/(\d{4}-\d{2}-\d{2})/)
  if (day) return day[1].slice(5)
  const epoch = name.match(/(\d{9,})\.parquet$/)
  if (epoch) {
    const d = new Date(Number(epoch[1]) * 1000)
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

const GROUPS = [
  ['converted', 'conv'],
  ['binanceAggTrades', 'binance'],
  ['cryptoPrices', 'chainlink'],
]

// Column set = union of dataset keys across all reachable machines.
const datasetCols = []
for (const [group, label] of GROUPS) {
  const keys = new Set()
  for (const r of rows) {
    for (const k of Object.keys(r.status?.datasets?.[group] ?? {})) keys.add(k)
  }
  for (const k of [...keys].sort()) datasetCols.push({ group, key: k, header: `${label} ${k}` })
}

function cell(r, col) {
  if (r.status == null) return ''
  const inv = r.status.datasets?.[col.group]?.[col.key]
  const files = inv?.files ?? 0
  return files === 0 ? '—' : `${files}·${newestDate(inv.newest) ?? '?'}`
}

function machineCells(r) {
  if (r.status == null) {
    if (r.probe?.unreachable) {
      return [r.host, r.role, '✗ unreachable', '', '', ...datasetCols.map(() => '')]
    }
    const rc = r.probe?.rc == null ? '' : ` rc=${r.probe.rc}`
    const rawDetail = r.probe?.error?.trim() || (r.probe?.rc === 0 ? 'invalid probe output' : '')
    const detail = rawDetail === '' ? '' : `: ${rawDetail.replace(/\s+/g, ' ').slice(0, 80)}`
    return [r.host, r.role, `✗ probe failed${rc}${detail}`, '', '', ...datasetCols.map(() => '')]
  }
  const s = r.status
  const sess = `${s.sessions.backtestWorker.alive ? 'W' : '-'}${s.sessions.telonexConverter.alive ? 'C' : '-'}`
  return [
    r.host,
    r.role,
    `${s.git.branch}@${s.git.commit}${s.git.dirty ? '*' : ''}`,
    sess,
    `${s.diskFreeGb}GB`,
    ...datasetCols.map((c) => cell(r, c)),
  ]
}

const header = ['machine', 'role', 'git', 'W/C', 'free', ...datasetCols.map((c) => c.header)]
const table = [header, ...rows.map(machineCells)]
const widths = header.map((_, i) => Math.max(...table.map((row) => String(row[i] ?? '').length)))

console.log('')
console.log('='.repeat(widths.reduce((a, b) => a + b + 2, 0)))
for (const [i, row] of table.entries()) {
  console.log(row.map((c, j) => String(c ?? '').padEnd(widths[j])).join('  '))
  if (i === 0) console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)))
}
console.log('')
console.log(
  "Inventory only — what each machine HAS. What is MISSING: npm run fleet:data:sync -- <pairs> -e data_sync_extra='--dry-run'",
)
console.log(
  "W/C = backtest worker / telonex converter tmux session up. '*' after commit = dirty tree.",
)
