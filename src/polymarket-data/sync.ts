#!/usr/bin/env tsx
/**
 * polymarket-data sync: the one command to run the whole pipeline.
 *
 * Runs the stages in order — markets → positions → trades → deep-backfill →
 * activity → verify — as sequential child processes. Sequential on purpose:
 * every stage draws on the same Polymarket rate budget, so running them (or
 * several of these wrappers) in parallel just trips 429s. One at a time is both
 * correct and, with the default RPS, about as fast as the API allows.
 *
 * Selection: `--symbol` / `--timeframe` accept comma-separated lists (omit for
 * all). They scope the market stages; activity is wallet-based and runs once
 * over whatever wallets those markets discovered.
 *
 * Usage:
 *   npm run polymarket-data:sync                              # everything, all symbols/timeframes
 *   npm run polymarket-data:sync -- --symbol btc --timeframe 5m,15m
 *   npm run polymarket-data:sync -- --full                   # rescan from the backfill floor
 *   npm run polymarket-data:sync -- --dry-run                # print the plan, run nothing
 *
 * Flags:
 *   --symbol <a,b>            symbols to sync (default: all)
 *   --timeframe <a,b>         timeframes to sync (default: all)
 *   --from <date> --to <date> catalog window (default: resume → now)
 *   --full                    catalog: rescan from the backfill floor, ignoring stored state
 *   --concurrency <n>         positions/trades/activity worker count (default 6)
 *   --wallet-concurrency <n>  deep-backfill per-market wallet fan-out (default 16)
 *   --stale-after <hours>     activity: also refresh wallets not synced in N hours (default 120)
 *   --resample <n>            verify: re-check N markets against the live API (default 10)
 *   --skip <stages>           comma list of stages to skip (markets,positions,trades,backfill,activity,verify)
 *   --dry-run                 print the commands that would run, then exit
 */

import '../config/env.js'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/index.js'
import { isTimeframe, SYMBOLS, type Timeframe } from './marketSeries.js'

const LABEL = '[polymarket-data:sync]'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TSX = path.join(HERE, '..', '..', 'node_modules', '.bin', 'tsx')

const STAGE_KEYS = ['markets', 'positions', 'trades', 'backfill', 'activity', 'verify'] as const
type StageKey = (typeof STAGE_KEYS)[number]

type Args = {
  symbols: string[] | null
  timeframes: Timeframe[] | null
  from?: string
  to?: string
  full: boolean
  concurrency: number
  walletConcurrency: number
  staleAfterHours: number
  resample: number
  skip: Set<StageKey>
  dryRun: boolean
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '')
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    symbols: null,
    timeframes: null,
    full: false,
    concurrency: 6,
    walletConcurrency: 16,
    staleAfterHours: 120,
    resample: 10,
    skip: new Set(),
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--symbol') {
      const list = parseList(argv[++i] ?? '')
      for (const s of list)
        if (!SYMBOLS.includes(s)) throw new Error(`${LABEL} unknown symbol: ${s}`)
      out.symbols = list
    } else if (a === '--timeframe') {
      const list = parseList(argv[++i] ?? '')
      for (const t of list) if (!isTimeframe(t)) throw new Error(`${LABEL} unknown timeframe: ${t}`)
      out.timeframes = list as Timeframe[]
    } else if (a === '--from') {
      const v = argv[++i]
      if (v) out.from = v
    } else if (a === '--to') {
      const v = argv[++i]
      if (v) out.to = v
    } else if (a === '--full') out.full = true
    else if (a === '--concurrency') out.concurrency = Number(argv[++i] ?? '') || 6
    else if (a === '--wallet-concurrency') out.walletConcurrency = Number(argv[++i] ?? '') || 16
    else if (a === '--stale-after') out.staleAfterHours = Number(argv[++i] ?? '') || 120
    else if (a === '--resample') out.resample = Number(argv[++i] ?? '') || 10
    else if (a === '--skip') {
      for (const s of parseList(argv[++i] ?? '')) {
        if (!STAGE_KEYS.includes(s as StageKey)) throw new Error(`${LABEL} unknown stage: ${s}`)
        out.skip.add(s as StageKey)
      }
    } else if (a === '--dry-run') out.dryRun = true
    else throw new Error(`${LABEL} unknown arg: ${a}`)
  }
  return out
}

/**
 * Market-stage selectors. Each entry becomes one `--symbol X --timeframe Y`
 * invocation. Omitting a dimension yields a broader single call (the sub-scripts
 * treat a missing filter as "all"), so `--symbol btc` with no timeframe is one
 * call, not five.
 */
function marketSelectors(args: Args): string[][] {
  const symbols = args.symbols ?? [null as unknown as string]
  const timeframes = args.timeframes ?? [null as unknown as string]
  const out: string[][] = []
  for (const s of symbols) {
    for (const t of timeframes) {
      const sel: string[] = []
      if (s) sel.push('--symbol', s)
      if (t) sel.push('--timeframe', t)
      out.push(sel)
    }
  }
  return out
}

type Step = { stage: StageKey; script: string; args: string[] }

function plan(args: Args): Step[] {
  const selectors = marketSelectors(args)
  const steps: Step[] = []
  const add = (stage: StageKey, script: string, argsFor: (sel: string[]) => string[]) => {
    if (args.skip.has(stage)) return
    for (const sel of selectors) steps.push({ stage, script, args: argsFor(sel) })
  }

  const catalogExtra = [
    ...(args.full ? ['--full'] : []),
    ...(args.from ? ['--from', args.from] : []),
    ...(args.to ? ['--to', args.to] : []),
  ]
  add('markets', 'sync-markets.ts', (sel) => [...sel, ...catalogExtra])
  add('positions', 'sync-positions.ts', (sel) => [
    ...sel,
    '--concurrency',
    String(args.concurrency),
  ])
  add('trades', 'sync-trades.ts', (sel) => [...sel, '--concurrency', String(args.concurrency)])
  add('backfill', 'deep-backfill.ts', (sel) => [
    ...sel,
    '--wallet-concurrency',
    String(args.walletConcurrency),
  ])

  // Activity is wallet-based (not market-scoped), so it runs once regardless of
  // how many symbol/timeframe selectors there are.
  if (!args.skip.has('activity')) {
    steps.push({
      stage: 'activity',
      script: 'sync-activity.ts',
      args: [
        '--stale-after',
        String(args.staleAfterHours),
        '--concurrency',
        String(args.concurrency),
      ],
    })
  }

  add('verify', 'verify.ts', (sel) => [...sel, '--resample', String(args.resample)])
  return steps
}

function runStep(step: Step): Promise<void> {
  const scriptPath = path.join(HERE, step.script)
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [scriptPath, ...step.args], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) return reject(new Error(`${step.script} killed by ${signal}`))
      if (code !== 0) return reject(new Error(`${step.script} exited with code ${code}`))
      resolve()
    })
  })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const steps = plan(args)

  console.log(
    `${LABEL} ${steps.length} step(s); symbols=${args.symbols?.join(',') ?? 'all'} ` +
      `timeframes=${args.timeframes?.join(',') ?? 'all'}` +
      (args.skip.size > 0 ? ` skip=${[...args.skip].join(',')}` : ''),
  )

  if (args.dryRun) {
    for (const s of steps) {
      console.log(`${LABEL}   tsx src/polymarket-data/${s.script} ${s.args.join(' ')}`)
    }
    console.log(`${LABEL} dry-run: nothing executed`)
    return
  }

  const t0 = Date.now()
  const timings: Array<{ label: string; ms: number }> = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!
    const selLabel = s.args.filter((a) => !a.startsWith('--') && !/^\d/.test(a)).join(' ')
    console.log(`\n${LABEL} [${i + 1}/${steps.length}] ${s.stage}: ${s.script} ${s.args.join(' ')}`)
    const stepStart = Date.now()
    await runStep(s)
    const ms = Date.now() - stepStart
    timings.push({ label: `${s.stage}${selLabel ? ` ${selLabel}` : ''}`, ms })
    console.log(`${LABEL} [${i + 1}/${steps.length}] ${s.stage} took ${fmtDur(ms)}`)
  }

  const totalMs = Date.now() - t0
  console.log(`\n${LABEL} all ${steps.length} step(s) done in ${fmtDur(totalMs)}`)
  // Per-step breakdown, slowest first — makes the long pole (usually backfill on
  // BTC 5m) obvious at a glance.
  console.log(`${LABEL} time per step:`)
  for (const t of [...timings].sort((a, b) => b.ms - a.ms)) {
    console.log(`${LABEL}   ${fmtDur(t.ms).padStart(8)}  ${t.label}`)
  }

  await printSummary(args)
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/**
 * Bottom line for the synced scope: are the markets actually complete? The
 * per-stage logs scroll by, and "all steps done" only means the stages RAN — a
 * market can still be `partial` (fills missing) if deep-backfill didn't finish
 * it. This makes that visible in one place.
 */
async function printSummary(args: Args): Promise<void> {
  const conds = [sql`1 = 1`]
  if (args.symbols)
    conds.push(
      sql`symbol IN (${sql.join(
        args.symbols.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    )
  if (args.timeframes)
    conds.push(
      sql`timeframe IN (${sql.join(
        args.timeframes.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    )
  const where = sql.join(conds, sql` AND `)

  const db = getDb()
  const res = await db.execute(
    sql`SELECT
          SUM(trades_status = 'done') AS done_,
          SUM(trades_status = 'partial') AS partial_,
          SUM(trades_status = 'failed') AS failed_,
          SUM(trades_status = 'pending') AS pending_,
          COUNT(*) AS total_
        FROM polymarket_markets WHERE ${where}`,
  )
  const r = (res as unknown as Array<Array<Record<string, number | null>>>)[0]?.[0] ?? {}
  const n = (v: number | null | undefined) => Number(v ?? 0)
  const done = n(r.done_)
  const partial = n(r.partial_)
  const failed = n(r.failed_)
  const pending = n(r.pending_)

  console.log(
    `${LABEL} summary — markets in scope: ${n(r.total_)} ` +
      `(done=${done} partial=${partial} failed=${failed} pending=${pending})`,
  )
  if (partial > 0) {
    console.log(
      `${LABEL} ⚠ ${partial} market(s) still incomplete — re-run deep-backfill (or the whole sync) to finish them`,
    )
  }
  if (failed > 0) {
    console.log(
      `${LABEL} ⚠ ${failed} market(s) failed — re-run with the trades stage's --retry-failed`,
    )
  }
  if (partial === 0 && failed === 0 && pending === 0 && done > 0) {
    console.log(`${LABEL} ✓ every market in scope is complete`)
  }
}

main()
  .then(async () => {
    await closeDb()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(`${LABEL} FAILED: ${(err as Error).message}`)
    await closeDb().catch(() => {})
    process.exit(1)
  })
