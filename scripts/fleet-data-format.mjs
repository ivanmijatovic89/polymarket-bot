#!/usr/bin/env node
/**
 * fleet-data formatter — reads the JSON collected by
 * ops/ansible/data-sync-workers.yml and prints one aligned table built from
 * each host's own data:sync summary block: a row per machine, a column per
 * sync step, each cell status + the step's download count.
 *
 * Usage: node scripts/fleet-data-format.mjs /tmp/fleet-data.json
 */

import fs from 'node:fs'

const file = process.argv[2] ?? '/tmp/fleet-data.json'
const rows = JSON.parse(fs.readFileSync(file, 'utf8'))

/** Parse a host's stdout: the data:sync summary block → [{status, step, finding}]. */
function parseSummary(lines) {
  const out = []
  let inSummary = false
  for (const line of lines ?? []) {
    if (line.includes('[data:sync] summary:')) {
      inSummary = true
      continue
    }
    if (!inSummary) continue
    const m = line.match(/^\s{2}(OK|FAILED|SKIPPED)\s+(\S+)\s+\S+(?:\s+—\s+(.*))?$/)
    if (!m) {
      if (line.trim() === '' || line.startsWith('[data:sync]')) break
      continue
    }
    out.push({ status: m[1], step: m[2], finding: m[3] ?? '' })
  }
  return out
}

/** Pull the download/upload count out of a finding line, whatever its exact wording. */
function countOf(finding) {
  const m = finding.match(/to[ -]download[:=]\s*(\d+)/) ?? finding.match(/to[ -]upload[:=]\s*(\d+)/)
  return m ? Number(m[1]) : null
}

const parsed = rows.map((r) => ({ ...r, steps: parseSummary(r.stdoutLines) }))
const stepIds = [...new Set(parsed.flatMap((r) => r.steps.map((s) => s.step)))]

function cell(r, stepId) {
  if (r.rc == null) return '✗ unreachable'
  const s = r.steps.find((x) => x.step === stepId)
  if (!s) return r.rc === 0 ? '' : '?'
  const n = countOf(s.finding)
  if (s.status !== 'OK') return s.status
  return n == null ? 'OK' : `OK ${n}`
}

const header = ['machine', 'result', ...stepIds]
const table = [
  header,
  ...parsed.map((r) => [
    r.host,
    r.rc == null ? '✗ unreachable' : r.rc === 0 ? 'OK' : `FAILED rc=${r.rc}`,
    ...stepIds.map((id) => cell(r, id)),
  ]),
]
const widths = header.map((_, i) => Math.max(...table.map((row) => String(row[i] ?? '').length)))

console.log('')
console.log('='.repeat(widths.reduce((a, b) => a + b + 2, 0)))
for (const [i, row] of table.entries()) {
  console.log(row.map((c, j) => String(c ?? '').padEnd(widths[j])).join('  '))
  if (i === 0) console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)))
}
console.log('')
console.log('Cells show the step status and its download count (dry-run: what WOULD be fetched; real run: what the preflight found before fetching).')
