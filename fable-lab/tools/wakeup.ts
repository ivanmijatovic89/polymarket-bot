/**
 * wakeup.ts — one-shot orchestrator for the STATE.md successor wake-up
 * checks (D42). Runs every standing gate probe and prints a per-check
 * status so a fresh session sees the whole gated state in one command.
 *
 * Motivating friction (D42): sessions 42-55 each re-ran the same five
 * checks as separate tools plus manual git commands; check 4 exists
 * because an operator merge once sat unaudited for two sessions (D35);
 * and the CONFIRM-010 freeze byte-identity precondition (unlock item 3)
 * had NO standing check between freeze and unlock — drift would surface
 * only at unlock time, too late for clean attribution.
 *
 * This tool ORCHESTRATES; it does not replace the authoritative
 * instructions. STATE.md "Next" bullets remain the source of truth for
 * what to DO when a check fires — each firing check prints a pointer.
 * Baselines below are session-updated constants with provenance; update
 * them (with a STATE/Done note) only after ACTING on a change, so the
 * next session still sees the delta until it is handled.
 *
 * Read-only against lab state: DB SELECTs, dashboard GET, git read
 * commands, and one vendor HTTP request whose body is never downloaded
 * (the D40 probe measured that the 403 is issued before any transfer;
 * on a non-403 the request is aborted at headers — a few buffered KB
 * at most, no file written). Two benign exceptions: check 4 runs
 * `git fetch` (network + .git remote-tracking ref update, no worktree
 * change), and the spawned sub-tools open their own DB connections.
 *
 * Exit codes: 0 = all checks unchanged/closed; 2 = at least one check
 * CHANGED/FIRED (read its pointer); 1 = a check could not run.
 *
 * Usage: npx tsx fable-lab/tools/wakeup.ts [--skip-quota] [--skip-fleet]
 */
import '../../src/config/env.js'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// ---- Baselines (session-updated, provenance in comments) -------------------
const BASE = {
  // Check 1 — eligible universe (unchanged since U40; re-verified every session)
  eligibleTotal: 18635,
  lastMarketIso: '2026-06-14T09:30:00.000Z',
  holdoutBoundaryMs: 1777237200000, // frozen since U43
  // Check 2 — converted-bucket trades coverage (D39 baseline, U65)
  convertedRows: 18635,
  convertedHasTrades: 17878,
  // Check 2 — converter implementations on disk (U65b: none trades-aware)
  converterFiles: [
    'src/telonex/converters/delta.ts',
    'src/telonex/converters/deltaTyped.ts',
    'src/telonex/converters/paired.ts',
    'src/telonex/converters/parsing.ts',
    'src/telonex/converters/types.ts',
  ],
  // Check 4 — operator-commit audited point (U59/U61, D35)
  auditedBase: 'f1cf90b',
  auditedKnown: ['a10b59d'], // operator commits after base already audited
  // Check 5 — D40 quota probe target (known-good exploration asset/date,
  // the E6 market; 403 here = vendor download quota still exhausted)
  quotaUrl:
    'https://api.telonex.io/v1/downloads/polymarket/trades/2025-11-30?asset_id=22516848288580869205521197852083753544421892448013641475924444969400268470473',
  // Check 6 — CONFIRM-010 freeze anchor (U67/U67b, D41) + byte-identity list
  freezeCommit: 'c403d7d',
  freezeFiles: [
    'fable-lab/tools/calib3.ts',
    'fable-lab/strategies/_fixtures/diag-calib.ts',
    'fable-lab/tools/calib-integrity.sh',
  ],
}

let attention = 0
let failures = 0
function status(check: string, ok: boolean, line: string, pointer?: string): void {
  console.log(`[${ok ? 'ok' : 'CHANGED'}] ${check}: ${line}`)
  if (!ok) {
    attention++
    if (pointer) console.log(`          → ${pointer}`)
  }
}
function failed(check: string, err: unknown): void {
  failures++
  console.log(`[FAIL] ${check}: could not run (${String(err).split('\n')[0]}) — run the underlying tool by hand`)
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}
function runTool(rel: string, args: string[] = []): string {
  return execFileSync('npx', ['tsx', rel, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function check1Universe(): Promise<void> {
  const out = runTool('fable-lab/tools/universe.ts', ['--json'])
  const r = JSON.parse(out) as {
    eligibleTotal: number
    lastMarket: { iso: string }
    holdoutBoundaryMs: number
    catalogAwaitingIngestion: number
    catalogAwaitingMaxIso: string | null
  }
  const unchanged =
    r.eligibleTotal === BASE.eligibleTotal &&
    r.lastMarket.iso === BASE.lastMarketIso &&
    r.holdoutBoundaryMs === BASE.holdoutBoundaryMs
  status(
    'universe',
    unchanged,
    `${r.eligibleTotal} eligible, last ${r.lastMarket.iso}, boundary ${r.holdoutBoundaryMs}; ` +
      `awaiting ingestion ${r.catalogAwaitingIngestion} (through ${r.catalogAwaitingMaxIso ?? 'n/a'})`,
    'STATE check 1: universe GREW — venue-drift refresh on new month(s) (D27 redraw); at the IDEAS #10 unlock execute the FROZEN CONFIRM-010 spec',
  )
}

async function check2TradesGate(): Promise<void> {
  const files = git(['ls-files', 'src/telonex/converters']).split('\n').filter(Boolean)
  const newFiles = files.filter((f) => !BASE.converterFiles.includes(f))
  const out = runTool('fable-lab/tools/trades-coverage.ts')
  // catalog_rows prints unquoted (COUNT(*) → number), has_trades quoted (SUM → string)
  const m = /bucket: 'converted'[\s\S]*?catalog_rows: '?(\d+)'?[\s\S]*?has_trades: '?(\d+)'?/.exec(out)
  const rows = m ? Number(m[1]) : NaN
  const trades = m ? Number(m[2]) : NaN
  const unchanged =
    newFiles.length === 0 && rows === BASE.convertedRows && trades === BASE.convertedHasTrades
  status(
    'trades-gate',
    unchanged,
    `converted bucket ${rows}/${trades} has_trades; converter files ${files.length}` +
      (newFiles.length ? ` (NEW: ${newFiles.join(', ')})` : ' (known set)'),
    'STATE check 2: a NEW converter file or moved converted bucket — if a trades-aware converter exists, the queue-realistic fill model supersedes both D18 bracket ends (full pre-registration)',
  )
}

async function check3Fleet(skipCapacity: boolean): Promise<void> {
  // Registry regression probe (U58: RESOLVED is the expected state; GAP =
  // the operator REVERTED patch a10b59d — stop fleet submissions, D7/D10).
  // Runs even under --skip-fleet: it is a free local import and STATE
  // bullet 3 treats it as a standing regression check (U68 verifier).
  const reg = await import('../../src/strategy/strategyRegistry.js')
  const resolved = 'fable-exp-001' in reg.strategyRegistry
  status(
    'registry',
    resolved,
    resolved ? 'fable-exp-001 RESOLVED (fleet patch live)' : 'fable-exp-001 GAP',
    'STATE check 3: registry GAP — operator reverted a10b59d; fall back to local --sequential until reconciled',
  )
  if (skipCapacity) {
    console.log('[skip] fleet capacity relay (registry probe ran above)')
    return
  }
  try {
    const out = runTool('fable-lab/tools/capacity.ts')
    const slots = /TOTAL alive worker slots: (\d+)/.exec(out)
    console.log(`[info] fleet: ${slots ? `${slots[1]} alive worker slots` : 'slot count unparsed'} (capacity CHANGES — size batches from capacity.ts at submission time, never from here)`)
  } catch (err) {
    // capacity.ts exits 1 on unreachable dashboard or zero slots
    status('fleet', false, 'capacity.ts failed — dashboard down or ZERO alive slots', 'no fleet submissions until capacity.ts passes; smokes/debug stay local --sequential')
  }
}

async function check4OperatorDrift(): Promise<void> {
  let fetched = true
  try {
    // quiet fetch: progress goes to stderr which execFileSync pipes, not prints
    execFileSync('git', ['fetch', '--quiet', 'origin', 'fable-protocol'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    fetched = false
    console.log('[info] drift: git fetch failed (offline?) — drift check ran against the LOCAL origin ref')
  }
  // no --no-merges: STATE bullet 4's canonical command includes merges, and
  // D35's originating event WAS a merge commit (f1cf90b) — U68 verifier
  const log = git([
    'log',
    '--oneline',
    `${BASE.auditedBase}..origin/fable-protocol`,
    '--',
    'src/',
    'drizzle/',
    'dashboard/',
  ])
  const unaudited = log
    .split('\n')
    .filter(Boolean)
    .filter((l) => !BASE.auditedKnown.some((k) => l.startsWith(k)))
  status(
    'operator-drift',
    unaudited.length === 0,
    unaudited.length === 0
      ? `no unaudited non-lab commits touching src/, drizzle/, dashboard/ past ${BASE.auditedBase}+${BASE.auditedKnown.join(',')} ` +
        `(vs origin/fable-protocol ${git(['rev-parse', '--short', 'origin/fable-protocol'])}${fetched ? '' : ', UNFETCHED local ref'})`
      : `${unaudited.length} unaudited commit(s): ${unaudited.map((l) => l.slice(0, 60)).join(' | ')}`,
    'STATE check 4 (D35): audit the diff against lab dependencies before relying on conclusions citing touched files (method: knowledge/MERGE-AUDIT-2026-07-11-f1cf90b.md)',
  )
}

async function check5Quota(): Promise<void> {
  const apiKey = process.env.TELONEX_API_KEY
  if (!apiKey) {
    failed('quota', 'TELONEX_API_KEY not set or empty')
    return
  }
  const ctrl = new AbortController()
  const res = await fetch(BASE.quotaUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: ctrl.signal,
  })
  const blocked = res.status === 403
  // Never download the body: 403 is issued pre-transfer (D40 measurement);
  // any other status gets aborted at headers.
  ctrl.abort()
  status(
    'quota',
    blocked,
    blocked
      ? 'vendor download quota still EXHAUSTED (HTTP 403, zero bytes) — ingestion + sync re-runs stay suspended (DATASET-GROWTH.md §quota)'
      : `vendor responded HTTP ${res.status} (request aborted at headers)`,
    'STATE check 1 quota pointer: quota RESTORED — FIRST re-run tools/trades-schema-probe.ts --slug btc-updown-15m-1764461700 (D40), THEN the DATASET-GROWTH ingestion hand-off proceeds',
  )
}

async function check6FreezeIntegrity(): Promise<void> {
  const log = git(['log', '--oneline', `${BASE.freezeCommit}..HEAD`, '--', ...BASE.freezeFiles])
  const dirty = git(['status', '--porcelain', '--', ...BASE.freezeFiles])
  const intact = log === '' && dirty === ''
  status(
    'confirm-010-freeze',
    intact,
    intact
      ? `byte-identity holds since ${BASE.freezeCommit} (${BASE.freezeFiles.length} files, no commits, worktree clean)`
      : `DRIFTED: ${[log, dirty].filter(Boolean).join(' | ')}`,
    'CONFIRM-010 unlock item 3: any change requires a fresh-context re-audit of the changed tool against the frozen spec BEFORE running',
  )
}

async function main(): Promise<void> {
  console.log(`wake-up checks (D42 orchestrator) — HEAD ${git(['rev-parse', '--short', 'HEAD'])}, origin/fable-protocol ${git(['rev-parse', '--short', 'origin/fable-protocol'])}`)
  const skipQuota = process.argv.includes('--skip-quota')
  const skipFleet = process.argv.includes('--skip-fleet')
  const checks: Array<[string, () => Promise<void>, boolean]> = [
    ['universe', check1Universe, false],
    ['trades-gate', check2TradesGate, false],
    // --skip-fleet skips only the capacity relay; the registry probe always runs
    ['fleet', () => check3Fleet(skipFleet), false],
    ['operator-drift', check4OperatorDrift, false],
    ['quota', check5Quota, skipQuota],
    ['confirm-010-freeze', check6FreezeIntegrity, false],
  ]
  for (const [name, fn, skip] of checks) {
    if (skip) {
      console.log(`[skip] ${name}`)
      continue
    }
    try {
      await fn()
    } catch (err) {
      failed(name, err)
    }
  }
  if (failures > 0) {
    console.log(`RESULT: ${failures} check(s) FAILED to run — resolve or run by hand; ${attention} needing attention`)
    process.exit(1)
  }
  if (attention > 0) {
    console.log(`RESULT: ${attention} check(s) CHANGED/FIRED — follow their pointers (STATE.md Next bullets are authoritative)`)
    process.exit(2)
  }
  console.log('RESULT: all checks unchanged — gated state holds; verification depth or targeted diagnostics only (STATE check 5)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
