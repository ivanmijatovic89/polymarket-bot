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
import { LABEL, parseArgs, plan, type Args, type Step } from './syncPlan.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TSX = path.join(HERE, '..', '..', 'node_modules', '.bin', 'tsx')

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
