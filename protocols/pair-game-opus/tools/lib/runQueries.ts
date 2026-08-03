/**
 * lib/runQueries.ts — shared read-only queries over backtest result tables.
 *
 * Factored out of run-backtest.ts's recovery query so results.ts / compare.ts
 * and the launcher report identical numbers from one code path. Read-only.
 *
 * Column semantics (memory/capabilities/metrics-storage.md):
 *   - run-level stats live ONLY in backtest_run_segments (kind='all');
 *     backtest_runs is identity/provenance.
 *   - capital units derive from backtest_run_markets.cost, which for
 *     no-sell/no-split/no-merge strategies IS fee-inclusive invested capital
 *     (verified run 856). unitsValid flags the split_cost==0 precondition;
 *     sells are not detectable from stored rows — enforced by RULES instead.
 *   - pnl is already net of taker fees; never subtract fees_paid again.
 */
import mysql from 'mysql2/promise'

export async function openDb(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST!,
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USERNAME!,
    password: process.env.DATABASE_PASSWORD!,
    database: process.env.DATABASE_NAME!,
  })
}

/** mysql2 returns DECIMAL columns as strings; normalize for arithmetic. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export type RunIdentity = {
  runId: number
  batchUid: string
  submissionUid: string
  status: string
  strategy: string
  params: Record<string, unknown>
  protocol: string | null
  model: string | null
  marketsPersisted: number
  failuresCount: number
  createdAt: string
  cmd: string | null
  /** Parsed from cmd; null when the run's latency was env-sourced (RULES: such a run is not evidence). */
  latencyDelayMs: number | null
  latencyJitterMs: number | null
}

/** RULES require flag-pinned latency precisely so it is recoverable from cmd. */
export function parseLatencyFromCmd(cmd: string | null): {
  delayMs: number | null
  jitterMs: number | null
} {
  if (!cmd) return { delayMs: null, jitterMs: null }
  const d = /--latency-delay-ms[= ](\d+)/.exec(cmd)
  const j = /--latency-jitter-ms[= ](\d+)/.exec(cmd)
  return { delayMs: d ? Number(d[1]) : null, jitterMs: j ? Number(j[1]) : null }
}

function rowToIdentity(r: Record<string, unknown>): RunIdentity {
  const cmd = r.cmd ? String(r.cmd) : null
  const lat = parseLatencyFromCmd(cmd)
  return {
    runId: Number(r.id),
    batchUid: String(r.batch_uid),
    submissionUid: String(r.submission_uid),
    status: String(r.status),
    strategy: String(r.strategy),
    params: (typeof r.params === 'string' ? JSON.parse(r.params) : (r.params ?? {})) as Record<
      string,
      unknown
    >,
    protocol: r.protocol ? String(r.protocol) : null,
    model: r.model ? String(r.model) : null,
    marketsPersisted: Number(r.markets_persisted),
    failuresCount: Number(r.failures_count),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    cmd,
    latencyDelayMs: lat.delayMs,
    latencyJitterMs: lat.jitterMs,
  }
}

const RUN_COLS =
  'id, batch_uid, submission_uid, status, strategy, params, protocol, model, markets_persisted, failures_count, created_at, cmd'

export async function fetchRunsByIds(conn: mysql.Connection, ids: number[]): Promise<RunIdentity[]> {
  if (ids.length === 0) return []
  const [rows] = (await conn.query(
    `SELECT ${RUN_COLS} FROM backtest_runs WHERE id IN (?) ORDER BY id`,
    [ids],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map(rowToIdentity)
}

export async function fetchRunsByBatchUid(
  conn: mysql.Connection,
  batchUid: string,
): Promise<RunIdentity[]> {
  const [rows] = (await conn.query(
    `SELECT ${RUN_COLS} FROM backtest_runs WHERE batch_uid = ? ORDER BY id`,
    [batchUid],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map(rowToIdentity)
}

/** Launcher labels become batch_uid prefixes: '<label>-<utc>-<rand>'. */
export async function fetchRunsByLabel(
  conn: mysql.Connection,
  label: string,
  limit: number,
): Promise<RunIdentity[]> {
  const [rows] = (await conn.query(
    `SELECT ${RUN_COLS} FROM backtest_runs WHERE batch_uid LIKE ? ORDER BY id DESC LIMIT ?`,
    [`${label}-%`, limit],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map(rowToIdentity).sort((a, b) => a.runId - b.runId)
}

/** Most recent protocol-tagged runs (any launcher). */
export async function fetchRecentProtocolRuns(
  conn: mysql.Connection,
  protocol: string,
  limit: number,
): Promise<RunIdentity[]> {
  const [rows] = (await conn.query(
    `SELECT ${RUN_COLS} FROM backtest_runs WHERE protocol = ? ORDER BY id DESC LIMIT ?`,
    [protocol, limit],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map(rowToIdentity).sort((a, b) => a.runId - b.runId)
}

/** The kind='all' segment row — the source of truth for run-level stats. */
export async function fetchHeadline(
  conn: mysql.Connection,
  runId: number,
): Promise<Record<string, unknown> | null> {
  const [rows] = (await conn.query(
    `SELECT pnl_total, total_fees_paid, ev_per_market_total, ev_per_market_played,
            markets_total, markets_played, markets_won, markets_lost,
            markets_skipped, markets_no_in_window_activity, markets_flat_with_trades,
            win_rate_pct, trades_total, trades_maker, trades_taker,
            quality_system, quality_trade,
            pnl_avg_win, pnl_avg_lose, pnl_max_win, pnl_max_lose,
            duration_wall_clock_ms
       FROM backtest_run_segments WHERE run_id = ? AND segment_kind = 'all' LIMIT 1`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows[0] ?? null
}

export type Units = {
  investedTotal: number | null
  profitPer100: number | null
  investedMax: number | null
  investedAvgPlayed: number | null
  /** false when any split_cost != 0 — the cost==invested precondition is broken. */
  unitsValid: boolean
}

/** Capital-aware units (memory/process/evaluator.md formulas 1-5). */
export async function fetchUnits(conn: mysql.Connection, runId: number): Promise<Units> {
  const [rows] = (await conn.query(
    `SELECT SUM(cost) AS invested_total,
            100*SUM(pnl)/NULLIF(SUM(cost),0) AS profit_per_100,
            MAX(cost) AS invested_max,
            AVG(NULLIF(cost,0)) AS invested_avg_played,
            SUM(ABS(split_cost)) AS split_cost_abs_total
       FROM backtest_run_markets WHERE run_id = ?`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  const r = rows[0] ?? {}
  return {
    investedTotal: toNum(r.invested_total),
    profitPer100: toNum(r.profit_per_100),
    investedMax: toNum(r.invested_max),
    investedAvgPlayed: toNum(r.invested_avg_played),
    unitsValid: (toNum(r.split_cost_abs_total) ?? 0) === 0,
  }
}

export type MarketRow = {
  slug: string
  marketStartMs: number
  finalOutcome: string
  skipReason: string | null
  pnl: number
  cost: number
  feesPaid: number
  tradeCount: number
  tradeAsMaker: number
  tradeAsTaker: number
  upShares: number
  downShares: number
  mergableShares: number
  avgEntryPriceUp: number | null
  avgEntryPriceDown: number | null
  machineId: string | null
  intentMeta: Array<Record<string, unknown>>
}

export async function fetchMarkets(conn: mysql.Connection, runId: number): Promise<MarketRow[]> {
  const [rows] = (await conn.query(
    `SELECT slug, market_start_ms, final_outcome, skip_reason, pnl, cost, fees_paid,
            trade_count, trade_as_maker, trade_as_taker,
            up_shares, down_shares, mergable_shares,
            avg_entry_price_up, avg_entry_price_down, machine_id, intent_meta
       FROM backtest_run_markets WHERE run_id = ? ORDER BY market_start_ms`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map((r) => ({
    slug: String(r.slug),
    marketStartMs: Number(r.market_start_ms),
    finalOutcome: String(r.final_outcome),
    skipReason: r.skip_reason ? String(r.skip_reason) : null,
    pnl: toNum(r.pnl) ?? 0,
    cost: toNum(r.cost) ?? 0,
    feesPaid: toNum(r.fees_paid) ?? 0,
    tradeCount: Number(r.trade_count),
    tradeAsMaker: Number(r.trade_as_maker),
    tradeAsTaker: Number(r.trade_as_taker),
    upShares: toNum(r.up_shares) ?? 0,
    downShares: toNum(r.down_shares) ?? 0,
    mergableShares: toNum(r.mergable_shares) ?? 0,
    avgEntryPriceUp: toNum(r.avg_entry_price_up),
    avgEntryPriceDown: toNum(r.avg_entry_price_down),
    machineId: r.machine_id ? String(r.machine_id) : null,
    intentMeta: (typeof r.intent_meta === 'string'
      ? JSON.parse(r.intent_meta)
      : Array.isArray(r.intent_meta)
        ? r.intent_meta
        : []) as Array<Record<string, unknown>>,
  }))
}

/**
 * Distinct engine commit SHAs across a run's market rows (MISSION01-REVIEW
 * M4). Fleet SHA-gating keeps a run internally consistent, so >1 SHA within
 * one run is an anomaly; ACROSS runs a mismatch means the compared runs were
 * produced by different engine versions — warn before trusting deltas.
 */
export async function fetchDistinctCommitShas(
  conn: mysql.Connection,
  runId: number,
): Promise<string[]> {
  const [rows] = (await conn.query(
    `SELECT DISTINCT commit_sha FROM backtest_run_markets WHERE run_id = ?`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map((r) => (r.commit_sha ? String(r.commit_sha) : '(null)')).sort()
}

/**
 * Earliest created_at among completed runs of one strategy with EXACTLY the
 * given params (MISSION01-REVIEW M2). A claimed design-ts LATER than this is
 * impossible for an honest param-freeze timestamp — no run can predate the
 * design of its own config. Params equality is checked in JS (JSON key-order
 * differences would break SQL string equality).
 */
export async function fetchEarliestRunForConfig(
  conn: mysql.Connection,
  strategy: string,
  params: Record<string, unknown>,
): Promise<{ runId: number; createdAt: string } | null> {
  const [rows] = (await conn.query(
    `SELECT id, params, created_at FROM backtest_runs
      WHERE strategy = ? AND status = 'completed' ORDER BY created_at ASC`,
    [strategy],
  )) as [Array<Record<string, unknown>>, unknown]
  const canon = (p: Record<string, unknown>): string =>
    JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b))))
  const want = canon(params)
  for (const r of rows) {
    const p = (typeof r.params === 'string' ? JSON.parse(r.params) : (r.params ?? {})) as Record<
      string,
      unknown
    >
    if (canon(p) === want) {
      return {
        runId: Number(r.id),
        createdAt:
          r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }
    }
  }
  return null
}

export async function fetchSegments(
  conn: mysql.Connection,
  runId: number,
  kind: string,
): Promise<Array<Record<string, unknown>>> {
  const [rows] = (await conn.query(
    `SELECT segment_key, from_ms, to_ms, pnl_total, ev_per_market_total,
            markets_total, markets_played, markets_won, markets_lost, win_rate_pct,
            trades_total, trades_maker, trades_taker, total_fees_paid
       FROM backtest_run_segments WHERE run_id = ? AND segment_kind = ? ORDER BY segment_ord`,
    [runId, kind],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows
}

export async function fetchFailures(
  conn: mysql.Connection,
  runId: number,
): Promise<Array<{ slug: string | null; reason: string }>> {
  const [rows] = (await conn.query(
    `SELECT slug, reason FROM backtest_run_failures WHERE run_id = ? ORDER BY id`,
    [runId],
  )) as [Array<Record<string, unknown>>, unknown]
  return rows.map((r) => ({ slug: r.slug ? String(r.slug) : null, reason: String(r.reason) }))
}

/** Quantile over a copy (linear interpolation); null on empty input. */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo)
}
