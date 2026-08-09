import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'

/**
 * TEMPORARY page (issue: watch the `directional-game-opus` protocol while it
 * runs). Everything for it lives in exactly two paths — this route and
 * `src/app/directional-game/` — so the whole feature is deleted with:
 *   rm -rf dashboard/src/app/directional-game dashboard/src/app/api/directional-game
 *
 * Sources: the protocol's own state files (read from `origin/main` of the
 * polymarket-protocols repo, no working-tree checkout needed), the Global
 * Runtime session rows, and the persisted level backtests.
 */

export const dynamic = 'force-dynamic'

const PROTOCOL = 'directional-game-opus'
const REPO = process.env.DIRECTIONAL_GAME_REPO ?? '/Users/mijat/Sites/polymarket-protocols'
const REF = 'origin/main'
const FETCH_INTERVAL_MS = 20_000

const exec = promisify(execFile)

let lastFetchMs = 0

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', REPO, ...args], { maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/** `git fetch` at most every FETCH_INTERVAL_MS; failures are non-fatal (stale read). */
async function refreshRemote(): Promise<string | null> {
  if (Date.now() - lastFetchMs < FETCH_INTERVAL_MS) return null
  lastFetchMs = Date.now()
  try {
    await git(['fetch', 'origin', '--quiet'])
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function readStateFile(name: string): Promise<string | null> {
  try {
    return await git(['show', `${REF}:${PROTOCOL}/state/${name}`])
  } catch {
    return null
  }
}

type LevelRow = {
  runId: number
  level: number
  batchUid: string
  status: string
  createdAtMs: number
  markets: number
  played: number
  wins: number
  losses: number
  pnl: number
  cost: number
}

async function readLevels(): Promise<LevelRow[]> {
  const db = getDb()
  const [rows] = (await db.execute(sql`
    SELECT r.id, r.batch_uid, r.status, r.created_at, r.markets_persisted,
           COUNT(m.id) AS markets,
           SUM(CASE WHEN m.cost > 0 THEN 1 ELSE 0 END) AS played,
           SUM(CASE WHEN m.cost > 0 AND m.pnl > 0 THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN m.cost > 0 AND m.pnl < 0 THEN 1 ELSE 0 END) AS losses,
           SUM(m.pnl) AS pnl,
           SUM(m.cost) AS cost
    FROM backtest_runs r
    LEFT JOIN backtest_run_markets m ON m.run_id = r.id
    WHERE r.protocol = ${PROTOCOL}
    GROUP BY r.id
    ORDER BY r.id DESC
    LIMIT 500
  `)) as unknown as [Array<Record<string, unknown>>, unknown]

  return rows.map((row) => {
    const batchUid = String(row.batch_uid ?? '')
    const labelled = /^lvl(\d+)/.exec(batchUid)
    return {
      runId: Number(row.id),
      level: labelled ? Number(labelled[1]) : Number(row.markets_persisted ?? 0),
      batchUid,
      status: String(row.status ?? ''),
      createdAtMs: new Date(row.created_at as string).getTime(),
      markets: Number(row.markets ?? 0),
      played: Number(row.played ?? 0),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      pnl: Number(row.pnl ?? 0),
      cost: Number(row.cost ?? 0),
    }
  })
}

// Mirrors tools/lib/levels.ts in the protocol repo.
const MIN_EV_PER_MARKET_USD = 1
const PARTICIPATION_FLOOR = 0.7

type PrefixSummary = {
  runId: number
  createdAtMs: number
  markets: number
  passedLevel: number
  pnlAtPassed: number
  playedAtPassed: number
  minPlayedAtPassed: number
  nextLevel: number | null
  nextShortfallUsd: number | null
  finalPnl: number
  finalPlayed: number
}

/**
 * Prefix scoring (tools/prefixScan.ts): one run over the first M markets is
 * evidence for every level N <= M. Level N passes when cumulative PnL over the
 * first N markets is >= $1 x N and played >= ceil(0.70 N); the claimed level is
 * the end of the contiguous PASS prefix — NOT the run's market count.
 */
async function readPrefix(levels: LevelRow[]): Promise<PrefixSummary | null> {
  const source = levels.find((l) => l.status === 'completed' && l.batchUid.startsWith('lvl'))
  if (!source) return null
  const db = getDb()
  const [rows] = (await db.execute(sql`
    SELECT pnl, cost
    FROM backtest_run_markets
    WHERE run_id = ${source.runId}
    ORDER BY market_start_ms ASC, idx ASC
  `)) as unknown as [Array<Record<string, unknown>>, unknown]

  let cum = 0
  let played = 0
  let passed = 0
  let pnlAtPassed = 0
  let playedAtPassed = 0
  let contiguous = true
  let next: { level: number; shortfall: number } | null = null
  for (let i = 0; i < rows.length; i++) {
    cum += Number(rows[i]?.pnl ?? 0)
    if (Number(rows[i]?.cost ?? 0) > 0) played++
    const level = i + 1
    const pass = cum >= MIN_EV_PER_MARKET_USD * level && played >= Math.ceil(level * PARTICIPATION_FLOOR)
    if (pass && contiguous) {
      passed = level
      pnlAtPassed = cum
      playedAtPassed = played
    } else if (!pass && contiguous) {
      contiguous = false
      next = { level, shortfall: MIN_EV_PER_MARKET_USD * level - cum }
    }
  }
  return {
    runId: source.runId,
    createdAtMs: source.createdAtMs,
    markets: rows.length,
    passedLevel: passed,
    pnlAtPassed,
    playedAtPassed,
    minPlayedAtPassed: Math.ceil(passed * PARTICIPATION_FLOOR),
    nextLevel: next?.level ?? null,
    nextShortfallUsd: next?.shortfall ?? null,
    finalPnl: cum,
    finalPlayed: played,
  }
}

async function readRuntime() {
  const db = getDb()
  // The protocol may have been restarted: several runtime_runs rows share the
  // workspace. Header shows the newest run; the session list spans all of them.
  const [runRows] = (await db.execute(sql`
    SELECT id, name, status, machine_id, model, effort, max_sessions, created_at, updated_at
    FROM runtime_runs
    WHERE workspace_path LIKE ${`%${PROTOCOL}`}
    ORDER BY id DESC
  `)) as unknown as [Array<Record<string, unknown>>, unknown]

  const run = runRows[0]
  if (!run) return { run: null, sessions: [] as Array<Record<string, unknown>> }
  const runIds = runRows.map((r) => Number(r.id))

  const [sessionRows] = (await db.execute(sql`
    SELECT run_id, session_number, status, action, summary, error, started_at, finished_at,
           input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
           estimated_api_cost_usd, resolved_model
    FROM runtime_sessions
    WHERE run_id IN ${runIds}
    ORDER BY run_id DESC, session_number DESC
    LIMIT 60
  `)) as unknown as [Array<Record<string, unknown>>, unknown]

  const [totalRows] = (await db.execute(sql`
    SELECT COUNT(*) AS sessions,
           SUM(estimated_api_cost_usd) AS cost,
           SUM(input_tokens) AS input_tokens,
           SUM(output_tokens) AS output_tokens
    FROM runtime_sessions
    WHERE run_id = ${Number(run.id)}
  `)) as unknown as [Array<Record<string, unknown>>, unknown]

  const [allTotalRows] = (await db.execute(sql`
    SELECT COUNT(*) AS sessions, SUM(estimated_api_cost_usd) AS cost
    FROM runtime_sessions
    WHERE run_id IN ${runIds}
  `)) as unknown as [Array<Record<string, unknown>>, unknown]

  const totals = totalRows[0] ?? {}
  const allTotals = allTotalRows[0] ?? {}

  return {
    run: {
      id: Number(run.id),
      name: String(run.name ?? ''),
      status: String(run.status ?? ''),
      machineId: String(run.machine_id ?? ''),
      model: run.model ? String(run.model) : null,
      effort: run.effort ? String(run.effort) : null,
      maxSessions: Number(run.max_sessions ?? 0),
      updatedAtMs: new Date(run.updated_at as string).getTime(),
      sessionsDone: Number(totals.sessions ?? 0),
      costUsd: totals.cost === null || totals.cost === undefined ? null : Number(totals.cost),
      inputTokens: Number(totals.input_tokens ?? 0),
      outputTokens: Number(totals.output_tokens ?? 0),
      allRuns: runIds.length,
      allSessionsDone: Number(allTotals.sessions ?? 0),
      allCostUsd:
        allTotals.cost === null || allTotals.cost === undefined ? null : Number(allTotals.cost),
    },
    sessions: sessionRows.map((s) => ({
      runId: Number(s.run_id),
      number: Number(s.session_number),
      status: String(s.status ?? ''),
      action: s.action ? String(s.action) : null,
      summary: s.summary ? String(s.summary) : null,
      error: s.error ? String(s.error) : null,
      startedAtMs: s.started_at ? new Date(s.started_at as string).getTime() : null,
      finishedAtMs: s.finished_at ? new Date(s.finished_at as string).getTime() : null,
      costUsd:
        s.estimated_api_cost_usd === null || s.estimated_api_cost_usd === undefined
          ? null
          : Number(s.estimated_api_cost_usd),
      model: s.resolved_model ? String(s.resolved_model) : null,
    })),
  }
}

export async function GET() {
  try {
    const gitError = await refreshRemote()
    const [status, champion, journal, proposals, inbox] = await Promise.all([
      readStateFile('STATUS.md'),
      readStateFile('CHAMPION.md'),
      readStateFile('JOURNAL.md'),
      readStateFile('PROPOSALS.md'),
      readStateFile('INBOX.md'),
    ])
    const [levels, runtime] = await Promise.all([readLevels(), readRuntime()])
    const prefix = await readPrefix(levels)

    return NextResponse.json(
      {
        fetchedAtMs: Date.now(),
        gitError,
        state: { status, champion, journal, proposals, inbox },
        levels,
        prefix,
        ...runtime,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
