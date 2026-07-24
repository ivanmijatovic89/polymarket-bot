#!/usr/bin/env tsx
/**
 * Download converted Telonex parquet from R2 down to its canonical local path.
 *
 * For a given converter (+ optional symbol/timeframe/slug filters) this
 * queries the SAME eligibility definition the backtest uses
 * (`listEligibleTelonexMarkets` in src/db/telonexMarkets.ts — the single source
 * of truth) with `readFrom: 'r2'`, then streams each market's converted parquet
 * from R2 to:
 *
 *   data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet
 *
 * which is exactly where `telonex:convert --output local` would have written it
 * (path comes from the shared `localOutputPath` helper). After fetching, those
 * markets can be backtested with `--read-from local` (no per-tick R2 fetch).
 *
 * Concurrency = a coordinator/worker pool, modelled on the backtest worker
 * (src/cli/backtestWorker.ts): one PARENT process queries the DB, computes which
 * markets are missing locally, and forks N CHILD processes (real Node processes,
 * via tsx). The parent hands each missing market to exactly one child over IPC
 * (pull-based: a child asks, the parent pops the next job) — so there is no
 * overlap, no DB-side claiming, and no fragile sharding. If a child dies mid-job
 * the parent re-queues that market for another child.
 *
 * Read-only on the DB (parent only). Writes only under data/events/telonex/,
 * atomically (`<file>.<pid>.tmp` → rename). Idempotent: skips files already on
 * disk unless `--force`.
 *
 * Usage:
 *   npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m
 *   npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m --concurrency 8
 *   npm run telonex:download-converted-r2-to-local -- --converter paired --slug btc-updown-15m-1760140800
 *
 * See docs/datasets/telonex/download-converted-r2-to-local.md for the full guide.
 */

import '../config/env.js'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  listEligibleTelonexMarkets,
  type Converter,
  type EligibleMarketsQuery,
} from '../db/telonexMarkets.js'
import { closeDb } from '../db/index.js'
import { TELONEX_DATASET_ELIGIBLE_FROM_MS } from '../config/telonex.js'
import { downloadR2ToLocal } from './fetchConvertedToLocal.js'
import { localOutputPath } from './localOutputPath.js'

// Eligibility query caps at 1000 when no limit is passed; we want the whole set.
const NO_LIMIT = 100_000_000
// Bounded parallelism for the pre-flight local-existence scan.
const STAT_CONCURRENCY = 64

type Job = { r2Url: string; absolute: string; slug: string; expectedSize: number | null }
type Outcome = 'downloaded' | 'failed'

// IPC message shapes between parent and child.
type ParentMsg = { type: 'job'; job: Job } | { type: 'shutdown' }
type ChildMsg =
  | { type: 'ready' }
  | { type: 'result'; slug: string; outcome: Outcome; bytes: number }

type Args = {
  converter: Converter
  symbol?: string
  timeframe?: string
  slugs?: string[]
  latest: boolean
  limit?: number
  concurrency: number
  force: boolean
  dryRun: boolean
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)}KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)}MB`
  return `${(mb / 1024).toFixed(2)}GB`
}

function fmtDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '—'
  const s = Math.round(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** Sub-second-precision elapsed formatter for step timings. */
function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// -----------------------------------------------------------------------------
// Child process: download one job at a time, report back, ask for the next.
// -----------------------------------------------------------------------------

function isChildMode(argv: string[]): boolean {
  return argv.includes('--child-id') && typeof process.send === 'function'
}

async function downloadJob(job: Job): Promise<{ outcome: Outcome; bytes: number }> {
  try {
    const { bytes } = await downloadR2ToLocal(job.r2Url, job.absolute)
    return { outcome: 'downloaded', bytes }
  } catch (err) {
    console.error(
      `[telonex:dl-converted] FAIL ${job.slug}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { outcome: 'failed', bytes: 0 }
  }
}

function runChild(): void {
  const send = (m: ChildMsg): void => {
    process.send?.(m)
  }
  const handle = async (msg: ParentMsg): Promise<void> => {
    if (msg.type === 'shutdown') {
      process.exit(0)
    }
    if (msg.type === 'job') {
      const r = await downloadJob(msg.job)
      send({ type: 'result', slug: msg.job.slug, outcome: r.outcome, bytes: r.bytes })
    }
  }
  process.on('message', (msg: ParentMsg) => {
    void handle(msg)
  })
  send({ type: 'ready' })
}

// -----------------------------------------------------------------------------
// Parent process: query, pre-flight, fork children, dispatch.
// -----------------------------------------------------------------------------

/** Parse a required integer flag value; throw a clear error on missing/invalid input. */
function requireIntArg(flag: string, raw: string | undefined, min: number): number {
  if (raw === undefined) {
    throw new Error(`[telonex:dl-converted] ${flag} requires a value`)
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`[telonex:dl-converted] ${flag} must be an integer >= ${min}, got: ${raw}`)
  }
  return n
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    converter: 'delta-typed',
    latest: false,
    concurrency: 1,
    force: false,
    dryRun: false,
  }
  let converterSeen = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--converter') {
      const v = argv[++i]
      if (v !== 'delta-typed' && v !== 'paired') {
        throw new Error(`[telonex:dl-converted] --converter must be delta-typed|paired, got ${v}`)
      }
      out.converter = v
      converterSeen = true
    } else if (a === '--symbol') {
      out.symbol = (argv[++i] ?? '').toLowerCase()
    } else if (a === '--timeframe') {
      const v = argv[++i]
      if (v !== undefined) out.timeframe = v
    } else if (a === '--slug') {
      out.slugs = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    } else if (a === '--latest') {
      out.latest = true
    } else if (a === '--limit') {
      out.limit = requireIntArg('--limit', argv[++i], 1)
    } else if (a === '--concurrency') {
      out.concurrency = requireIntArg('--concurrency', argv[++i], 1)
    } else if (a === '--force') {
      out.force = true
    } else if (a === '--dry-run') {
      out.dryRun = true
    } else {
      throw new Error(`[telonex:dl-converted] unknown arg: ${a}`)
    }
  }
  if (!converterSeen) {
    throw new Error(
      '[telonex:dl-converted] --converter is required (delta-typed|paired), ' +
        'e.g. --converter delta-typed --symbol btc --timeframe 15m',
    )
  }
  if (out.timeframe !== undefined && out.symbol === undefined) {
    throw new Error('[telonex:dl-converted] --timeframe is only valid together with --symbol')
  }
  if (out.latest && out.limit === undefined) {
    throw new Error('[telonex:dl-converted] --latest requires --limit')
  }
  return out
}

/** Resolve the eligible market set into download jobs (one per market with r2_url). */
async function buildCandidates(args: Args): Promise<Job[]> {
  const query: EligibleMarketsQuery = {
    converter: args.converter,
    readFrom: 'r2',
    latest: args.latest,
    limit: args.limit ?? NO_LIMIT,
    ...(args.symbol !== undefined ? { symbol: args.symbol } : {}),
    ...(args.timeframe !== undefined ? { timeframe: args.timeframe } : {}),
    ...(args.slugs !== undefined ? { slugs: args.slugs } : {}),
  }
  const markets = await listEligibleTelonexMarkets(query)
  return markets.flatMap((m) => {
    if (!m.dataset) {
      console.warn(`[telonex:dl-converted] WARN no r2_url for ${m.slug}, skipping`)
      return []
    }
    const { absolute } = localOutputPath({
      converter: args.converter,
      symbol: m.symbol,
      timeframe: m.timeframe,
      slug: m.slug,
    })
    return [{ r2Url: m.dataset, absolute, slug: m.slug, expectedSize: m.conversionSizeBytes }]
  })
}

/**
 * Bounded-parallel local scan. Returns the subset that must be (re)downloaded:
 * files that are absent, plus files whose on-disk size differs from the
 * conversion's recorded size_bytes — a re-converted market (e.g. after a
 * stale-catalog repair) changes the R2 object, and a puller that only checks
 * existence would keep serving the stale local copy forever.
 */
async function partitionMissing(
  candidates: Job[],
  force: boolean,
): Promise<{ missing: Job[]; onLocal: number; drifted: number }> {
  if (force) return { missing: candidates.slice(), onLocal: 0, drifted: 0 }
  const present = new Array<boolean>(candidates.length).fill(false)
  const drift = new Array<boolean>(candidates.length).fill(false)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < candidates.length) {
      const i = next++
      const job = candidates[i]!
      const st = await fs.stat(job.absolute).catch(() => null)
      if (!st) continue
      if (job.expectedSize !== null && st.size !== job.expectedSize) {
        drift[i] = true
        console.log(
          `[telonex:dl-converted] ${job.slug}: local size ${st.size} != conversion size ${job.expectedSize} — stale copy, re-downloading`,
        )
      } else {
        present[i] = true
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(STAT_CONCURRENCY, candidates.length || 1) }, worker),
  )
  const missing = candidates.filter((_, i) => !present[i])
  const onLocal = present.filter(Boolean).length
  const drifted = drift.filter(Boolean).length
  return { missing, onLocal, drifted }
}

function resolveSelfAndTsx(): { self: string; tsx: string } {
  const self = fileURLToPath(import.meta.url)
  const tsx = path.resolve(
    process.cwd(),
    process.platform === 'win32' ? 'node_modules/.bin/tsx.cmd' : 'node_modules/.bin/tsx',
  )
  return { self, tsx }
}

/** Fork N children and pull-distribute the job queue across them. */
async function dispatch(jobs: Job[], concurrency: number): Promise<{ failed: number }> {
  const { self, tsx } = resolveSelfAndTsx()
  const queue = jobs.slice()
  const total = jobs.length
  const inFlight = new Map<number, Job>()
  const t0 = Date.now()
  let done = 0
  let downloaded = 0
  let failed = 0
  let bytes = 0
  let live = 0

  await new Promise<void>((resolve) => {
    const children: ChildProcess[] = []
    // A child can leave the pool via either 'exit' (spawned then exited) or
    // 'error' (failed to spawn at all — common on Windows if the tsx launcher
    // path is wrong). Run the teardown exactly once per child.
    const settled = new Set<number>()

    const settle = (childId: number, label: string): void => {
      if (settled.has(childId)) return
      settled.add(childId)
      live--
      const job = inFlight.get(childId)
      if (job) {
        inFlight.delete(childId)
        queue.push(job)
        console.warn(
          `[telonex:dl-converted] WARN child#${childId} ${label} mid-job ${job.slug}; re-queued`,
        )
      }
      if (live === 0) {
        if (queue.length > 0) {
          console.error(
            `[telonex:dl-converted] ERROR all workers gone with ${queue.length} job(s) left`,
          )
          failed += queue.length
        }
        resolve()
      }
    }

    const progress = (): void => {
      if (done % 100 === 0 || done === total) {
        const elapsedS = (Date.now() - t0) / 1000
        const rate = elapsedS > 0 ? done / elapsedS : 0
        const pct = total > 0 ? Math.floor((done / total) * 100) : 0
        const eta = rate > 0 ? fmtDuration((total - done) / rate) : '—'
        console.log(
          `[telonex:dl-converted] progress ${done}/${total} (${pct}%) ` +
            `downloaded=${downloaded} failed=${failed} ${fmtBytes(bytes)} ` +
            `${rate.toFixed(1)} mkt/s ETA ${eta}`,
        )
      }
    }

    const assign = (child: ChildProcess, childId: number): void => {
      const job = queue.shift()
      if (!job) {
        child.send({ type: 'shutdown' } as ParentMsg)
        return
      }
      inFlight.set(childId, job)
      child.send({ type: 'job', job } as ParentMsg)
    }

    const n = Math.min(concurrency, total)
    for (let i = 1; i <= n; i++) {
      const child = fork(self, ['--child-id', String(i)], {
        execPath: tsx,
        env: process.env,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      live++
      child.on('message', (msg: ChildMsg) => {
        if (msg.type === 'ready') {
          assign(child, i)
        } else if (msg.type === 'result') {
          inFlight.delete(i)
          done++
          if (msg.outcome === 'downloaded') downloaded++
          else failed++
          bytes += msg.bytes
          progress()
          assign(child, i)
        }
      })
      child.on('error', (err) => {
        console.error(
          `[telonex:dl-converted] ERROR child#${i} failed to run: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
        settle(i, 'errored')
      })
      child.on('exit', (code, signal) => {
        settle(i, `exited (code=${code} signal=${signal ?? ''})`)
      })
      children.push(child)
    }

    const onSignal = (): void => {
      for (const c of children) {
        try {
          c.kill('SIGTERM')
        } catch {
          // ignore
        }
      }
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
  })

  const elapsedS = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(
    `[telonex:dl-converted] done downloaded=${downloaded} failed=${failed} ` +
      `total=${total} ${fmtBytes(bytes)} in ${elapsedS}s`,
  )
  return { failed }
}

async function runParent(args: Args): Promise<void> {
  const scope = [
    `converter=${args.converter}`,
    args.symbol ? `symbol=${args.symbol}` : 'symbol=all',
    args.timeframe ? `timeframe=${args.timeframe}` : 'timeframe=all',
    `concurrency=${args.concurrency}`,
    args.force ? 'force' : null,
    args.dryRun ? 'dry-run' : null,
  ]
    .filter(Boolean)
    .join(' ')
  console.log(`[telonex:dl-converted] ${scope}`)

  const eligibleFrom = new Date(TELONEX_DATASET_ELIGIBLE_FROM_MS).toISOString().slice(0, 10)
  console.log(
    `[telonex:dl-converted] querying eligible markets from DB ` +
      `(market start >= ${eligibleFrom}, per TELONEX_DATASET_ELIGIBLE_FROM)…`,
  )
  const tQuery = Date.now()
  const candidates = await buildCandidates(args)
  console.log(
    `[telonex:dl-converted] queried ${candidates.length} eligible market(s) in ${fmtElapsed(Date.now() - tQuery)}`,
  )

  console.log(`[telonex:dl-converted] scanning ${candidates.length} local file(s)…`)
  const tScan = Date.now()
  const { missing, onLocal, drifted } = await partitionMissing(candidates, args.force)
  console.log(`[telonex:dl-converted] scanned local files in ${fmtElapsed(Date.now() - tScan)}`)

  console.log(
    `[telonex:dl-converted] r2 eligible: ${candidates.length}   ` +
      `on local: ${onLocal}   to download: ${missing.length}` +
      (drifted > 0 ? `   (of which stale/size-drift: ${drifted})` : ''),
  )

  if (args.dryRun) {
    console.log('[telonex:dl-converted] dry-run — nothing written')
    return
  }
  if (missing.length === 0) {
    console.log('[telonex:dl-converted] nothing to download')
    return
  }

  const { failed } = await dispatch(missing, args.concurrency)
  if (failed > 0) process.exitCode = 1
}

// -----------------------------------------------------------------------------
// Entry: child vs parent.
// -----------------------------------------------------------------------------

if (isChildMode(process.argv)) {
  runChild()
} else {
  void (async () => {
    try {
      await runParent(parseArgs(process.argv.slice(2)))
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    } finally {
      await closeDb().catch(() => {})
    }
  })()
}
