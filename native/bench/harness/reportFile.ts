// Benchmark report files (16 §13.8): `native/reports/bench-<milestone>-
// <yyyymmdd>-<host>.md` plus a `.json` with every row, its conditions and
// raw repetitions. A second sitting on the same milestone, day and host
// appends its row; nothing earlier is overwritten.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { renderL0Row, type L0Row } from './l0.js'
import { renderL1Row, type L1Row } from './report.js'

export type ReportRow = L1Row | L0Row

export interface ReportFile {
  schemaVersion: 2
  milestone: string
  /** yyyymmdd, local. */
  date: string
  host: string
  rows: ReportRow[]
}

export class ReportFileError extends Error {
  override name = 'ReportFileError'
}

/** Milestone names of 01 §6 (`M1`, `M5a`, …). */
export function checkMilestone(m: string): string {
  if (!/^M[0-9]+[a-z]?$/.test(m)) {
    throw new ReportFileError(`milestone must look like M1 or M5a, got ${JSON.stringify(m)}`)
  }
  return m
}

export function reportBase(outDir: string, milestone: string, date: string, host: string): string {
  if (!/^[0-9]{8}$/.test(date)) throw new ReportFileError('date must be yyyymmdd')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(host)) throw new ReportFileError(`bad host label ${host}`)
  return path.join(outDir, `bench-${checkMilestone(milestone)}-${date}-${host}`)
}

/** The existing report at `base`, or a new empty one. */
export function loadReport(
  base: string,
  meta: { milestone: string; date: string; host: string },
): ReportFile {
  const json = `${base}.json`
  if (!fs.existsSync(json)) {
    if (fs.existsSync(`${base}.md`)) {
      throw new ReportFileError(`${base}.md exists without its .json; refusing to overwrite it`)
    }
    return { schemaVersion: 2, ...meta, rows: [] }
  }
  const raw = JSON.parse(fs.readFileSync(json, 'utf8')) as Partial<ReportFile>
  if (raw.schemaVersion !== 2 || !Array.isArray(raw.rows)) {
    throw new ReportFileError(`${json}: not a schemaVersion 2 bench report`)
  }
  if (raw.milestone !== meta.milestone || raw.date !== meta.date || raw.host !== meta.host) {
    throw new ReportFileError(`${json}: milestone/date/host differ from this run`)
  }
  return raw as ReportFile
}

export function renderReport(f: ReportFile): string {
  const d = `${f.date.slice(0, 4)}-${f.date.slice(4, 6)}-${f.date.slice(6)}`
  const lines = [
    `# Benchmark report ${f.milestone}: ${f.host} (${d})`,
    '',
    'Written by `scripts/native/bench-l0.ts` and `scripts/native/bench-l1.ts` (16 §13.8).',
    'The `.json` next to this file holds every row with its conditions and raw repetitions.',
    'Rows are appended in the order they ran; a row marked `non-idle` is never regression',
    'or gate evidence (16 §13.5).',
    '',
  ]
  f.rows.forEach((row, i) => {
    lines.push(row.level === 'L1' ? renderL1Row(row, i + 1) : renderL0Row(row, i + 1))
  })
  return `${lines.join('\n').trimEnd()}\n`
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

/**
 * Formats the written files with the repository's Prettier, so committed
 * reports pass `prettier --check` (CI) unchanged.
 */
export function prettierFormatter(repoRoot: string): (files: readonly string[]) => void {
  return (files) => {
    execFileSync(path.join(repoRoot, 'node_modules/.bin/prettier'), ['--write', ...files], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }
}

/** Appends `row` to the report at `base` and rewrites both files atomically. */
export function appendRow(
  base: string,
  meta: { milestone: string; date: string; host: string },
  row: ReportRow,
  format?: (files: readonly string[]) => void,
): ReportFile {
  const f = loadReport(base, meta)
  f.rows.push(row)
  fs.mkdirSync(path.dirname(base), { recursive: true })
  writeAtomic(`${base}.json`, `${JSON.stringify(f, null, 2)}\n`)
  writeAtomic(`${base}.md`, renderReport(f))
  format?.([`${base}.json`, `${base}.md`])
  return f
}
