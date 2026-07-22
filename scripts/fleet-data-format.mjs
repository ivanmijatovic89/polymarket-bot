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

// One inventory host can be both producer and worker. Keep those executions
// as distinct rows so neither result overwrites or hides the other.
const runRows = rows.flatMap((r) => {
  // Backward compatibility for recap files written by an older checkout.
  if (r.role != null) return [r]
  const out = []
  if (r.producer != null)
    out.push({ host: r.host, role: 'producer', dryRun: r.dryRun, ...r.producer })
  if (r.worker != null) out.push({ host: r.host, role: 'worker', dryRun: r.dryRun, ...r.worker })
  return out
})

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
  const m =
    finding.match(/to[ -]download[:=]\s*(\d+)/) ??
    finding.match(/to[ -]upload[:=]\s*(\d+)/) ??
    finding.match(/queue(?: size)?=(\d+)/) ??
    finding.match(/pending=(\d+)/)
  return m ? Number(m[1]) : null
}

/** Last "run elapsed X" occurrence = the machine's total data:sync time. */
function runElapsed(lines) {
  let out = null
  for (const line of lines ?? []) {
    const m = line.match(/run elapsed ([0-9hms.]+)/)
    if (m) out = m[1]
  }
  return out
}

const parsed = runRows.map((r) => {
  const steps = parseSummary(r.stdoutLines)
  const dryRun =
    r.dryRun ?? (r.stdoutLines ?? []).some((l) => l.includes('DRY-RUN') || l.includes('--dry-run'))
  const counts = steps.map((s) => countOf(s.finding)).filter((n) => n != null)
  const behind = counts.reduce((a, b) => a + b, 0)
  const failed =
    r.rc == null || r.rc !== 0 || steps.length === 0 || steps.some((s) => s.status !== 'OK')
  const synced = !failed && behind === 0
  return { ...r, steps, time: runElapsed(r.stdoutLines), dryRun, behind, failed, synced }
})

function cell(r, stepId) {
  if (r.rc == null) return '⚠️'
  const s = r.steps.find((x) => x.step === stepId)
  if (!s) return r.rc === 0 ? '' : '?'
  if (s.status !== 'OK') return `🔴 ${s.status}`
  const n = countOf(s.finding)
  if (n == null) return '✅'
  if (anyDryRun) return n === 0 ? '✅' : `🔴 missing ${n}`
  return `✅ ${n}`
}

const anyDryRun = parsed.some((r) => r.dryRun)
const producers = parsed.filter((r) => r.role === 'producer' && (r.rc != null || anyDryRun))
const workers = parsed.filter((r) => r.role !== 'producer')

function resultCell(r) {
  if (r.rc == null) return '⚠️  unreachable'
  if (r.rc !== 0) return `🔴 FAILED rc=${r.rc}`
  if (r.steps.length === 0) return '🔴 NO SUMMARY'
  if (!anyDryRun) return '✅ OK'
  return r.synced ? '✅ SYNCED' : `🔴 BEHIND (${r.behind})`
}

function printTable(rowsIn, title) {
  if (rowsIn.length === 0) return
  const ids = [...new Set(rowsIn.flatMap((r) => r.steps.map((s) => s.step)))]
  const header = ['machine', 'result', 'time', ...ids]
  const table = [
    header,
    ...rowsIn.map((r) => [r.host, resultCell(r), r.time ?? '', ...ids.map((id) => cell(r, id))]),
  ]
  const widths = header.map((_, i) => Math.max(...table.map((row) => String(row[i] ?? '').length)))
  console.log('')
  if (title) console.log(title)
  console.log('='.repeat(widths.reduce((a, b) => a + b + 2, 0)))
  for (const [i, row] of table.entries()) {
    console.log(row.map((c, j) => String(c ?? '').padEnd(widths[j])).join('  '))
    if (i === 0) console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)))
  }
}

printTable(producers, anyDryRun ? 'PRODUCER vs upstream (catalog check skipped — see docs)' : null)
printTable(workers, producers.length > 0 ? 'WORKERS vs R2' : null)
console.log('')
if (anyDryRun) {
  const laggards = parsed.filter((r) => !r.synced)
  if (laggards.length === 0) {
    console.log('✅ FLEET SYNCED — every machine is fully up to date.')
  } else {
    console.log(
      `🔴 FLEET NOT SYNCED — ${laggards.map((r) => `${r.host}:${r.role} (${r.rc == null ? 'unreachable' : r.failed ? 'failed' : `-${r.behind}`})`).join(', ')}`,
    )
    process.exitCode = 1
  }
} else {
  console.log(
    'Cells show the step status and its download count (what the preflight found before fetching).',
  )
  const failures = parsed.filter((r) => r.failed)
  if (failures.length > 0) {
    console.log(
      `🔴 FLEET DATA SYNC FAILED — ${failures.map((r) => `${r.host}:${r.role}`).join(', ')}`,
    )
    process.exitCode = 1
  }
}
