/**
 * refresh-capabilities.ts — capability self-upgrade detector (mission-01 goal 2).
 *
 * Each note in memory/capabilities/*.md carries two header lines:
 *   verified: <date> @ <short-sha> (...)     — the engine commit the note was verified at
 *   watches: <path>[, <path> ...]            — the engine paths the note's claims depend on
 *
 * This tool diffs each note's recorded SHA against a target ref (default
 * origin/main) over ONLY that note's watched paths, and reports which notes are
 * stale and which files drifted. It also runs a global "uncovered" sweep: files
 * changed in the surveyed engine area that NO note watches — new engine
 * territory nobody has notes on yet.
 *
 * Human trigger (one command, safe/read-only):
 *   npx tsx protocols/pair-fable/tools/refresh-capabilities.ts
 *
 * Flags:
 *   --target <ref>          compare against this ref instead of origin/main
 *   --assume-note-sha <sha> override every note's recorded SHA (drift simulation / testing)
 *   --no-fetch              skip `git fetch origin main` (offline / testing)
 *   --json                  machine-parsable output
 *
 * Exit codes: 0 = all notes current and nothing uncovered; 1 = drift found
 * (stale notes and/or uncovered files) or a note failed to parse; 2 = usage or
 * git error. Read-only: never edits notes, never touches the DB.
 *
 * The fold-back procedure (what to do when this reports drift) is documented in
 * memory/process/capability-refresh.md.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TOOLS_DIR, '../../..')
const CAP_DIR = join(TOOLS_DIR, '../memory/capabilities')

// Global surveyed area for the uncovered sweep — the union of engine paths the
// mission surveyed. A changed file in here that no note watches is a signal to
// extend the notes, not silently ignore.
const GLOBAL_WATCH = [
  'src/cli',
  'src/backtest',
  'src/trading',
  'src/strategy',
  'src/market',
  'src/db',
  'src/polymarket',
  'src/parquet',
  'src/config',
  'package.json',
  'scripts/run-worker.sh',
  'ops',
]

interface NoteReport {
  note: string
  sha: string | null
  verifiedDate: string | null
  watches: string[]
  status: 'CURRENT' | 'STALE' | 'ERROR'
  changedFiles: string[]
  error?: string
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

function parseArgs(argv: string[]) {
  const opts = { target: 'origin/main', assumeNoteSha: null as string | null, fetch: true, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--target') opts.target = argv[++i]
    else if (a === '--assume-note-sha') opts.assumeNoteSha = argv[++i]
    else if (a === '--no-fetch') opts.fetch = false
    else if (a === '--json') opts.json = true
    else {
      console.error(`unknown flag: ${a}\nusage: refresh-capabilities.ts [--target <ref>] [--assume-note-sha <sha>] [--no-fetch] [--json]`)
      process.exit(2)
    }
  }
  if (!opts.target || (argv.includes('--assume-note-sha') && !opts.assumeNoteSha)) {
    console.error('missing value for --target / --assume-note-sha')
    process.exit(2)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))

if (opts.fetch) {
  try {
    execFileSync('git', ['fetch', 'origin', 'main'], { cwd: REPO_ROOT, stdio: 'pipe' })
  } catch (e) {
    console.error(`git fetch origin main failed (${(e as Error).message.split('\n')[0]}); rerun with --no-fetch to compare against the local ref`)
    process.exit(2)
  }
}

let targetSha: string
try {
  targetSha = git(['rev-parse', opts.target])
} catch {
  console.error(`cannot resolve target ref '${opts.target}'`)
  process.exit(2)
}

// Validate a watch path exists in the target tree — a typo'd path would
// otherwise silently diff empty and hide drift forever.
function pathExistsInTarget(path: string): boolean {
  const out = execFileSync('git', ['ls-tree', '--name-only', targetSha, '--', path], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim()
  return out.length > 0
}

const noteFiles = readdirSync(CAP_DIR).filter((f) => f.endsWith('.md')).sort()
const reports: NoteReport[] = []

for (const file of noteFiles) {
  const text = readFileSync(join(CAP_DIR, file), 'utf8')
  const verifiedMatch = text.match(/^verified:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*@\s*([0-9a-f]{7,40})/m)
  const watchesMatch = text.match(/^watches:\s*(.+)$/m)
  const report: NoteReport = {
    note: file,
    sha: verifiedMatch ? verifiedMatch[2] : null,
    verifiedDate: verifiedMatch ? verifiedMatch[1] : null,
    watches: watchesMatch ? watchesMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : [],
    status: 'CURRENT',
    changedFiles: [],
  }
  if (!verifiedMatch) {
    report.status = 'ERROR'
    report.error = "no parseable 'verified: <date> @ <sha>' header"
  } else if (report.watches.length === 0) {
    report.status = 'ERROR'
    report.error = "no 'watches: <path>[, <path>...]' header — add one (see capability-refresh.md)"
  } else {
    const badPaths = report.watches.filter((p) => !pathExistsInTarget(p))
    if (badPaths.length > 0) {
      report.status = 'ERROR'
      report.error = `watched path(s) missing in ${opts.target}: ${badPaths.join(', ')} (typo, or the engine moved the file — update the watches line)`
    } else {
      const baseSha = opts.assumeNoteSha ?? report.sha!
      try {
        git(['cat-file', '-e', `${baseSha}^{commit}`])
      } catch {
        report.status = 'ERROR'
        report.error = `recorded SHA ${baseSha} not found in this clone`
      }
      if (report.status !== 'ERROR') {
        const diff = git(['diff', '--name-only', baseSha, targetSha, '--', ...report.watches])
        report.changedFiles = diff ? diff.split('\n') : []
        report.status = report.changedFiles.length > 0 ? 'STALE' : 'CURRENT'
      }
    }
  }
  reports.push(report)
}

// Uncovered sweep: from the oldest note baseline, over the global surveyed
// area, list changed files that no note's watches match.
const validShas = reports.map((r) => (opts.assumeNoteSha ?? r.sha)).filter((s): s is string => !!s)
let uncovered: string[] = []
let uncoveredBase: string | null = null
if (validShas.length > 0) {
  uncoveredBase = validShas
    .map((sha) => ({ sha, time: Number(git(['show', '-s', '--format=%ct', sha]) || 0) }))
    .sort((a, b) => a.time - b.time)[0].sha
  const allWatched = reports.flatMap((r) => r.watches)
  const covered = (f: string) => allWatched.some((w) => f === w || f.startsWith(w.endsWith('/') ? w : w + '/'))
  const globalDiff = git(['diff', '--name-only', uncoveredBase, targetSha, '--', ...GLOBAL_WATCH])
  uncovered = (globalDiff ? globalDiff.split('\n') : []).filter((f) => !covered(f))
}

const stale = reports.filter((r) => r.status === 'STALE')
const errors = reports.filter((r) => r.status === 'ERROR')
const drift = stale.length > 0 || errors.length > 0 || uncovered.length > 0

if (opts.json) {
  console.log(
    JSON.stringify(
      {
        target: opts.target,
        targetSha,
        assumeNoteSha: opts.assumeNoteSha,
        notes: reports,
        uncovered: { base: uncoveredBase, files: uncovered },
        verdict: drift ? 'DRIFT' : 'CLEAN',
      },
      null,
      2,
    ),
  )
} else {
  console.log(`target: ${opts.target} @ ${targetSha.slice(0, 7)}${opts.assumeNoteSha ? `  (simulating note baseline ${opts.assumeNoteSha})` : ''}`)
  console.log('')
  for (const r of reports) {
    const base = opts.assumeNoteSha ?? r.sha
    console.log(`${r.status.padEnd(7)} ${r.note}  (verified ${r.verifiedDate ?? '?'} @ ${base ?? '?'})`)
    if (r.error) console.log(`         ! ${r.error}`)
    for (const f of r.changedFiles) console.log(`         ~ ${f}`)
  }
  console.log('')
  if (uncovered.length > 0) {
    console.log(`UNCOVERED (changed since ${uncoveredBase?.slice(0, 7)} in the surveyed area, watched by NO note):`)
    for (const f of uncovered) console.log(`         ~ ${f}`)
    console.log('')
  }
  console.log(
    drift
      ? `VERDICT: DRIFT — ${stale.length} stale note(s), ${errors.length} error(s), ${uncovered.length} uncovered file(s). Fold-back procedure: memory/process/capability-refresh.md`
      : 'VERDICT: CLEAN — all capability notes current at their recorded SHAs.',
  )
}

process.exit(drift ? 1 : 0)
