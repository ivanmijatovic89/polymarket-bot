/**
 * run-backtest.ts — the canonical pair-game-opus backtest launcher.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-game-opus/tools/run-backtest.ts --strategy <id> [options]
 *
 * Why this exists instead of calling `npm run backtest` directly:
 *   1. RULES pins are ENFORCED, not remembered: input-mode telonex-delta,
 *      read-from local-or-download-from-r2-to-local, symbol btc, timeframe
 *      15m, universe floor --from-ms 1775088000000 (2026-04-02), latency
 *      140/20 ms, provenance --protocol pair-game-opus --model <id>.
 *   2. Unknown flags are a HARD ERROR. The raw CLI silently drops unknown
 *      `--flags` (src/cli/helpers/backtestArgs.ts:414-417) — a typo like
 *      `--lattest` silently changes the market selection.
 *   3. Deterministic run-id recovery (P-003 workaround): every launch gets a
 *      generated unique --batchUid; after the CLI exits the run is recovered
 *      via `WHERE batch_uid = ?` (indexed) — works for sequential AND queue
 *      paths, no newest-row race.
 *   4. --extend is REFUSED: extensions do not replay the parent's pinned
 *      latency (PROPOSALS P-001), and every pair-game-opus run is latency-pinned
 *      by RULES, so extending any of our runs would silently mix latencies.
 *   5. Queue submissions pre-check that HEAD is on origin/main (workers gate
 *      jobs on the producer SHA; an unpushed commit hangs the batch in
 *      `delayed` with no error).
 *
 * Options:
 *   --strategy <id>          required
 *   --param k=v              repeatable, passed through
 *   --limit N                market count cap. Omitted ⇒ the FULL universe:
 *                            an explicit huge --limit is injected, because the
 *                            engine's listEligibleTelonexMarkets silently caps
 *                            at 1000 when no limit is passed
 *                            (src/db/telonexMarkets.ts:117,276 — run 864
 *                            "full" run persisted exactly 1000 markets)
 *   --latest | --random      selection mode (both require --limit)
 *   --slug s1,s2             explicit slugs; replaces symbol/timeframe/floor
 *                            pins; slugs below the floor need --override-floor
 *   --from-ms N | --to-ms N  window override; from-ms below the 2026-04-02
 *                            floor needs --override-floor
 *   --latency-delay-ms N     deliberate latency override (default 140)
 *   --latency-jitter-ms N    deliberate jitter override (default 20)
 *   --sweep-latency a,b,c    one run per delay value (exclusive with
 *                            --latency-delay-ms); shares one label
 *   --sequential             run locally in-process (required for unpushed code)
 *   --detach                 enqueue and exit (queue path only); no run id yet
 *   --comment <text>         passed through
 *   --label <name>           batchUid prefix for grouping (default 'pgo');
 *                            batch_uid becomes '<label>-<utc>-<rand>' — group
 *                            queries use `batch_uid LIKE '<label>-%'`
 *   --model <id>             provenance model override (default claude-opus-5)
 *   --override-floor         acknowledge a below-floor universe (deliberate)
 *   --dry-run                validate + print composed argv, launch nothing
 *   --json                   machine-parsable result on stdout
 *
 * Output contract: child backtest output streams to STDERR; stdout carries
 * only the final result (JSON object with --json, or an array for sweeps).
 */
import '../../../src/config/env.js'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type mysql from 'mysql2/promise'
import { openDb, fetchRunsByBatchUid, fetchHeadline, fetchUnits, type Units } from './lib/runQueries.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx')
const BACKTEST_ENTRY = path.join(ROOT, 'src', 'cli', 'backtest.ts')

// RULES pins (protocols/pair-game-opus/RULES.md)
const FLOOR_MS = 1775088000000 // 2026-04-02T00:00:00Z protocol universe floor
const DEFAULT_LATENCY_DELAY_MS = 140
const DEFAULT_LATENCY_JITTER_MS = 20
const DEFAULT_MODEL = 'opus'
const PROTOCOL = 'pair-game-opus'
// Injected when the caller passes no --limit: defeats the engine's silent
// LIMIT 1000 default so "no limit" really is the whole eligible universe.
const FULL_UNIVERSE_LIMIT = 1000000

// ---------------------------------------------------------------------------
// Argument parsing — every flag must be known; unknown flags are fatal.
// ---------------------------------------------------------------------------

type Opts = {
  strategy?: string | undefined
  params: string[]
  limit?: number
  latest: boolean
  random: boolean
  slugs?: string[]
  fromMs?: number
  toMs?: number
  latencyDelayMs?: number
  latencyJitterMs?: number
  sweepLatency?: number[]
  sequential: boolean
  detach: boolean
  comment?: string | undefined
  label: string
  model: string
  overrideFloor: boolean
  dryRun: boolean
  json: boolean
}

const VALUE_FLAGS = new Set([
  '--strategy',
  '--param',
  '--limit',
  '--slug',
  '--from-ms',
  '--to-ms',
  '--latency-delay-ms',
  '--latency-jitter-ms',
  '--sweep-latency',
  '--comment',
  '--label',
  '--model',
])
const BOOL_FLAGS = new Set([
  '--latest',
  '--random',
  '--sequential',
  '--detach',
  '--override-floor',
  '--dry-run',
  '--json',
])
// Flags this tool manages itself. Passing them is an error with a specific
// explanation, not a generic "unknown flag".
const MANAGED: Record<string, string> = {
  '--input-mode': 'pinned to telonex-delta by RULES',
  '--read-from': 'pinned to local-or-download-from-r2-to-local by RULES',
  '--symbol': 'pinned to btc by RULES (use --slug for explicit markets)',
  '--timeframe': 'pinned to 15m by RULES',
  '--protocol': `pinned to ${PROTOCOL} (provenance is not overridable)`,
  '--batchUid': 'generated by this tool (unique, for deterministic run recovery); use --label for grouping',
  '--baselineId': 'not part of the pair-game-opus workflow; use the raw CLI deliberately if truly needed',
  '--mode': 'orderbook mode is the only supported mode for this protocol',
  '--order': 'replay order is left at the engine default',
  '--time-driven': 'not part of the pair-game-opus workflow',
  '--realtime': 'not part of the pair-game-opus workflow',
  '--dir': 'telonex input only; --dir is for recorded parquet',
  '--extend':
    'REFUSED: --extend does not replay the parent run’s pinned latency (PROPOSALS P-001) — ' +
    'extension markets would silently run at env-default latency, mixing latencies inside one run. ' +
    'Launch a fresh run over the wider window instead.',
}

function fail(msg: string): never {
  console.error(`[run-backtest] ERROR: ${msg}`)
  process.exit(2)
}

function parseIntStrict(v: string | undefined, flag: string): number {
  if (v === undefined) fail(`${flag} requires a value`)
  const n = Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) fail(`${flag} must be a non-negative integer, got '${v}'`)
  return n
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    params: [],
    latest: false,
    random: false,
    sequential: false,
    detach: false,
    label: 'pgo',
    model: DEFAULT_MODEL,
    overrideFloor: false,
    dryRun: false,
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!
    const eq = raw.indexOf('=')
    const flag = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw
    const inlineVal = raw.startsWith('--') && eq > 0 ? raw.slice(eq + 1) : undefined
    const nextVal = (): string | undefined => (inlineVal !== undefined ? inlineVal : argv[++i])

    if (MANAGED[flag]) fail(`${flag}: ${MANAGED[flag]}`)
    if (!VALUE_FLAGS.has(flag) && !BOOL_FLAGS.has(flag)) {
      fail(
        `unknown flag '${flag}'. The raw backtest CLI silently drops unknown flags; this launcher does not.\n` +
          `  value flags: ${[...VALUE_FLAGS].join(' ')}\n` +
          `  bool flags:  ${[...BOOL_FLAGS].join(' ')}`,
      )
    }
    if (BOOL_FLAGS.has(flag) && inlineVal !== undefined) fail(`${flag} takes no value`)

    switch (flag) {
      case '--strategy':
        o.strategy = nextVal()
        break
      case '--param': {
        const v = nextVal()
        if (!v || !v.includes('=')) fail(`--param expects key=value, got '${v}'`)
        o.params.push(v)
        break
      }
      case '--limit':
        o.limit = parseIntStrict(nextVal(), '--limit')
        break
      case '--slug': {
        const v = nextVal()
        if (!v) fail('--slug requires a value')
        o.slugs = [...(o.slugs ?? []), ...v.split(',').map((s) => s.trim()).filter(Boolean)]
        break
      }
      case '--from-ms':
        o.fromMs = parseIntStrict(nextVal(), '--from-ms')
        break
      case '--to-ms':
        o.toMs = parseIntStrict(nextVal(), '--to-ms')
        break
      case '--latency-delay-ms':
        o.latencyDelayMs = parseIntStrict(nextVal(), '--latency-delay-ms')
        break
      case '--latency-jitter-ms':
        o.latencyJitterMs = parseIntStrict(nextVal(), '--latency-jitter-ms')
        break
      case '--sweep-latency': {
        const v = nextVal()
        if (!v) fail('--sweep-latency requires a comma list, e.g. 140,300,600')
        o.sweepLatency = v.split(',').map((s) => parseIntStrict(s.trim(), '--sweep-latency'))
        if (o.sweepLatency.length < 2) fail('--sweep-latency needs at least 2 values (otherwise use --latency-delay-ms)')
        break
      }
      case '--comment':
        o.comment = nextVal()
        break
      case '--label': {
        const v = nextVal()
        if (!v || !/^[A-Za-z0-9._-]{1,64}$/.test(v)) fail(`--label must match [A-Za-z0-9._-]{1,64}, got '${v}'`)
        o.label = v
        break
      }
      case '--model': {
        const v = nextVal()
        if (!v) fail('--model requires a value')
        o.model = v
        break
      }
      case '--latest':
        o.latest = true
        break
      case '--random':
        o.random = true
        break
      case '--sequential':
        o.sequential = true
        break
      case '--detach':
        o.detach = true
        break
      case '--override-floor':
        o.overrideFloor = true
        break
      case '--dry-run':
        o.dryRun = true
        break
      case '--json':
        o.json = true
        break
    }
  }
  return o
}

// ---------------------------------------------------------------------------
// Validation + composition
// ---------------------------------------------------------------------------

function validate(o: Opts): void {
  if (!o.strategy) fail('--strategy <id> is required')
  if (o.latest && o.random) fail('--latest and --random are mutually exclusive')
  if ((o.latest || o.random) && o.limit === undefined) fail('--latest/--random require --limit N')
  if (o.slugs && (o.fromMs !== undefined || o.toMs !== undefined))
    fail('--slug is an explicit market list; --from-ms/--to-ms do not apply')
  if (o.slugs && (o.latest || o.random)) fail('--slug is an explicit market list; --latest/--random do not apply')
  if (o.sweepLatency && o.latencyDelayMs !== undefined)
    fail('--sweep-latency and --latency-delay-ms are mutually exclusive')
  if (o.sweepLatency && o.detach && !o.json)
    console.error('[run-backtest] note: sweep + --detach prints batchUids only; recover run ids later by batch_uid')
  if (o.detach && o.sequential) fail('--detach only applies to the queue path, not --sequential')

  // Floor pin. --override-floor is the single deliberate escape hatch.
  if (o.fromMs !== undefined && o.fromMs < FLOOR_MS && !o.overrideFloor)
    fail(
      `--from-ms ${o.fromMs} is below the protocol universe floor ${FLOOR_MS} (2026-04-02T00:00Z, RULES). ` +
        'Pass --override-floor if this is deliberate.',
    )
  if (o.slugs) {
    for (const slug of o.slugs) {
      const m = /^btc-updown-15m-(\d+)$/.exec(slug)
      if (!m) fail(`slug '${slug}' is not a btc-updown-15m-<epochSeconds> slug (protocol scope is btc 15m only)`)
      const startMs = Number(m[1]) * 1000
      if (startMs < FLOOR_MS && !o.overrideFloor)
        fail(
          `slug '${slug}' starts before the protocol floor (2026-04-02T00:00Z, RULES). ` +
            'Pass --override-floor if this is deliberate.',
        )
    }
  }
}

function uniqueBatchUid(label: string): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '') // 20260730T140501
  const rand = Math.random().toString(36).slice(2, 8)
  return `${label}-${ts}-${rand}`
}

function composeArgv(o: Opts, latencyDelayMs: number, batchUid: string): string[] {
  const argv: string[] = ['--strategy', o.strategy!]
  for (const p of o.params) argv.push('--param', p)
  argv.push('--input-mode', 'telonex-delta', '--read-from', 'local-or-download-from-r2-to-local')
  if (o.slugs) {
    argv.push('--slug', o.slugs.join(','))
  } else {
    argv.push('--symbol', 'btc', '--timeframe', '15m')
    argv.push('--from-ms', String(o.fromMs ?? FLOOR_MS))
    if (o.toMs !== undefined) argv.push('--to-ms', String(o.toMs))
  }
  // No --limit means "full universe" — but the engine's eligibility query
  // silently defaults to LIMIT 1000 (src/db/telonexMarkets.ts:276), so an
  // explicit no-op cap must be injected to actually get every market.
  argv.push('--limit', String(o.limit ?? FULL_UNIVERSE_LIMIT))
  if (o.latest) argv.push('--latest')
  if (o.random) argv.push('--random')
  argv.push('--latency-delay-ms', String(latencyDelayMs))
  argv.push('--latency-jitter-ms', String(o.latencyJitterMs ?? DEFAULT_LATENCY_JITTER_MS))
  argv.push('--protocol', PROTOCOL, '--model', o.model)
  argv.push('--batchUid', batchUid)
  if (o.comment !== undefined) argv.push('--comment', o.comment)
  if (o.sequential) argv.push('--sequential')
  if (o.detach) argv.push('--detach')
  return argv
}

// ---------------------------------------------------------------------------
// Queue-path pre-flight: HEAD must be reachable from origin/main.
// ---------------------------------------------------------------------------

function git(args: string[]): { status: number; stdout: string } {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: (r.stdout ?? '').trim() }
}

function assertHeadOnOriginMain(): void {
  const ls = git(['ls-remote', 'origin', 'refs/heads/main'])
  if (ls.status !== 0 || !ls.stdout) fail('cannot read origin/main (git ls-remote failed) — check network/remote')
  const remoteSha = ls.stdout.split(/\s+/)[0]!
  if (git(['cat-file', '-e', `${remoteSha}^{commit}`]).status !== 0) {
    console.error('[run-backtest] fetching origin/main to verify SHA ancestry…')
    if (git(['fetch', '--quiet', 'origin', 'main']).status !== 0) fail('git fetch origin main failed')
  }
  const head = git(['rev-parse', 'HEAD']).stdout
  if (git(['merge-base', '--is-ancestor', head, remoteSha]).status !== 0) {
    fail(
      `HEAD (${head.slice(0, 8)}) is not on origin/main (${remoteSha.slice(0, 8)}). ` +
        'Workers gate jobs on the producer SHA — an unpushed commit hangs the batch in `delayed` with no error. ' +
        'Push first (commit → git pull --rebase origin main → git push origin HEAD:main), or use --sequential for local runs.',
    )
  }
}

// ---------------------------------------------------------------------------
// Launch + deterministic recovery
// ---------------------------------------------------------------------------

type LaunchResult = {
  batchUid: string
  latencyDelayMs: number
  latencyJitterMs: number
  exitCode: number
  detached: boolean
  submissionUid: string | null
  runId: number | null
  status: string | null
  strategy: string | null
  marketsPersisted: number | null
  failuresCount: number | null
  headline: Record<string, unknown> | null
  units: Units | null
  cmd?: string
}

function launchChild(argv: string[]): Promise<{ exitCode: number; submissionUid: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [BACKTEST_ENTRY, ...argv], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let submissionUid: string | null = null
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      buf += s
      const m = /submissionUid=([0-9a-f-]+)/.exec(buf)
      if (m) submissionUid = m[1]!
      if (buf.length > 65536) buf = buf.slice(-8192)
      process.stderr.write(s) // child output is progress, never the result
    })
    child.stderr.on('data', (d: Buffer) => process.stderr.write(d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ exitCode: code ?? 1, submissionUid }))
  })
}

async function recoverRun(
  conn: mysql.Connection,
  batchUid: string,
): Promise<Pick<
  LaunchResult,
  'runId' | 'status' | 'strategy' | 'marketsPersisted' | 'failuresCount' | 'submissionUid' | 'headline' | 'units' | 'cmd'
> | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const runs = await fetchRunsByBatchUid(conn, batchUid)
    if (runs.length > 1) console.error(`[run-backtest] WARNING: ${runs.length} runs share batch_uid ${batchUid}; using newest`)
    const run = runs[runs.length - 1] // fetch orders by id ASC; newest last
    if (run) {
      const [headline, units] = await Promise.all([fetchHeadline(conn, run.runId), fetchUnits(conn, run.runId)])
      return {
        runId: run.runId,
        status: run.status,
        strategy: run.strategy,
        submissionUid: run.submissionUid,
        marketsPersisted: run.marketsPersisted,
        failuresCount: run.failuresCount,
        headline,
        units,
        ...(run.cmd !== null ? { cmd: run.cmd } : {}),
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return null
}

function printHuman(r: LaunchResult): void {
  const h = r.headline ?? {}
  const u: Partial<Units> = r.units ?? {}
  console.log(
    [
      `runId=${r.runId ?? 'NOT-FOUND'} status=${r.status ?? '-'} exit=${r.exitCode} batchUid=${r.batchUid}`,
      `latency=${r.latencyDelayMs}/${r.latencyJitterMs}ms markets=${r.marketsPersisted ?? '-'} failures=${r.failuresCount ?? '-'}`,
      `pnl=${h.pnl_total ?? '-'} evPerMarketTotal=${h.ev_per_market_total ?? '-'} fees=${h.total_fees_paid ?? '-'}`,
      `played=${h.markets_played ?? '-'}/${h.markets_total ?? '-'} won/lost=${h.markets_won ?? '-'}/${h.markets_lost ?? '-'} winRate%=${h.win_rate_pct ?? '-'}`,
      `trades maker/taker=${h.trades_maker ?? '-'}/${h.trades_taker ?? '-'} wallClockMs=${h.duration_wall_clock_ms ?? '-'}`,
      `investedTotal=${u.investedTotal ?? '-'} profitPer100=${u.profitPer100 ?? '-'} investedMax=${u.investedMax ?? '-'} investedAvgPlayed=${u.investedAvgPlayed ?? '-'}`,
    ].join('\n'),
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const o = parseArgs(process.argv.slice(2))
validate(o)

const delays = o.sweepLatency ?? [o.latencyDelayMs ?? DEFAULT_LATENCY_DELAY_MS]
const jitter = o.latencyJitterMs ?? DEFAULT_LATENCY_JITTER_MS
const launches = delays.map((d) => ({ delay: d, batchUid: uniqueBatchUid(o.label), argv: [] as string[] }))
for (const l of launches) l.argv = composeArgv(o, l.delay, l.batchUid)

if (o.dryRun) {
  const plan = launches.map((l) => ({ batchUid: l.batchUid, latencyDelayMs: l.delay, latencyJitterMs: jitter, argv: l.argv }))
  console.log(JSON.stringify(o.sweepLatency ? plan : plan[0], null, 2))
  process.exit(0)
}

if (!o.sequential) assertHeadOnOriginMain()

const results: LaunchResult[] = []
let conn: mysql.Connection | null = null
try {
  for (const l of launches) {
    console.error(`[run-backtest] launching latency=${l.delay}/${jitter}ms batchUid=${l.batchUid}`)
    const { exitCode, submissionUid } = await launchChild(l.argv)
    const r: LaunchResult = {
      batchUid: l.batchUid,
      latencyDelayMs: l.delay,
      latencyJitterMs: jitter,
      exitCode,
      detached: o.detach,
      submissionUid,
      runId: null,
      status: null,
      strategy: null,
      marketsPersisted: null,
      failuresCount: null,
      headline: null,
      units: null,
    }
    if (!o.detach) {
      conn ??= await openDb()
      const rec = await recoverRun(conn, l.batchUid)
      if (rec) Object.assign(r, rec)
      else console.error(`[run-backtest] WARNING: no backtest_runs row found for batch_uid=${l.batchUid} (exit=${exitCode})`)
    }
    results.push(r)
  }
} finally {
  await conn?.end()
}

if (o.json) {
  console.log(JSON.stringify(o.sweepLatency ? results : results[0], (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2))
} else {
  for (const r of results) printHuman(r)
}
const worst = Math.max(...results.map((r) => r.exitCode), ...results.map((r) => (r.detached || r.runId !== null ? 0 : 1)))
process.exit(worst)
