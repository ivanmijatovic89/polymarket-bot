/**
 * evaluate.ts — the executable form of memory/process/evaluator.md: stage
 * verdicts for one variant from stored runs. Read-only.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/evaluate.ts --full-run 870
 *   tsx protocols/pair-fable/tools/evaluate.ts --full-run 870 \
 *     --design-ts 2026-07-30T19:40:00Z \
 *     --sweep-runs 865,866,867,869 \
 *     --screen-run 863 --screen-baseline 868 [--noise-ev 0.0008] [--json]
 *
 * Stages (evaluator.md §Stages — thresholds live THERE, this file computes):
 *   MECHANICAL  status/failures/unitsValid/latency-pinned checks on every run,
 *               PLUS (MISSION01-REVIEW M1) params identity of full/sweep/screen
 *               runs and latency identity of the screen pair, (M4) within-run
 *               engine-SHA consistency, (m6, --maker-only) taker share ≤ 2% on
 *               the base-latency runs
 *   S1 SCREEN   ev delta vs baseline on slug intersection vs noise floor
 *   S2 FULL     headline + weekly walk-forward (engine computeWalkForwardForRun,
 *               partial weeks < 300 markets dropped) + monthly table
 *   S3 SWEEP    intersection EV per cmd-recorded latency + taker-share trend
 *               (a RISING taker trend now FAILS the sweep — m6)
 *   S4 OOS      design-ts split of the full run's market rows; CHAMPION bar is
 *               noise-aware: OOS ev must exceed 2×SE(n), not just 0 (M3);
 *               --design-ts is sanity-checked against the earliest completed
 *               run of the exact config (M2 — design cannot postdate first run)
 *
 * Cross-run engine-SHA mismatches and M2 violations surface as WARNINGS (M4:
 * benign launcher-level engine commits are common; a warning forces the reader
 * to decide, a hard fail would block honest comparisons).
 *
 * Verdict = first failing stage, else highest attained state. Stages without
 * inputs report NA (never silently pass). Exit 0 when evaluable (verdicts are
 * data, not errors); exit 2 on bad flags / missing runs.
 */
import '../../../src/config/env.js'
import { computeWalkForwardForRun } from '../../../src/backtest/stats/walkForwardRank.js'
import {
  openDb,
  toNum,
  quantile,
  fetchRunsByIds,
  fetchHeadline,
  fetchUnits,
  fetchMarkets,
  fetchSegments,
  fetchDistinctCommitShas,
  fetchEarliestRunForConfig,
  type RunIdentity,
  type MarketRow,
  type Units,
} from './lib/runQueries.js'

// evaluator.md calibrations (change THERE first, then here)
const DEFAULT_NOISE_EV = 0.05
const SCREEN_MIN_DELTA = 0.05
const WEEKLY_MIN_MARKETS = 300
const OOS_MIN_MARKETS = 400
const SWEEP_RETENTION = 0.5
const BASE_LATENCY_MS = 140
const OOS_SE_MULTIPLE = 2 // M3: champion bar = OOS ev > 2×SE(n)
const MAKER_ONLY_MAX_TAKER_SHARE = 0.02 // m6: mechanical bound with --maker-only
const SWEEP_TAKER_RISE_PP = 0.02 // m6: taker-share rise (last−first) that fails S3

function fail(msg: string): never {
  console.error(`[evaluate] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = {
  fullRun?: number
  designTs?: number
  sweepRuns?: number[]
  screenRun?: number
  screenBaseline?: number
  noiseEv?: number
  makerOnly: boolean
  json: boolean
}

function parseIds(v: string, flag: string): number[] {
  return v.split(',').map((s) => {
    const n = Number(s.trim())
    if (!Number.isInteger(n) || n <= 0) fail(`${flag} expects positive run ids, got '${s}'`)
    return n
  })
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { makerOnly: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) fail(`${flag} requires a value`)
      return v
    }
    switch (flag) {
      case '--full-run':
        o.fullRun = parseIds(next(), '--full-run')[0]!
        break
      case '--design-ts': {
        const v = next()
        const ms = /^\d+$/.test(v) ? Number(v) : Date.parse(v)
        if (!Number.isFinite(ms)) fail(`--design-ts expects epoch ms or ISO 8601, got '${v}'`)
        o.designTs = ms
        break
      }
      case '--sweep-runs':
        o.sweepRuns = parseIds(next(), '--sweep-runs')
        break
      case '--screen-run':
        o.screenRun = parseIds(next(), '--screen-run')[0]!
        break
      case '--screen-baseline':
        o.screenBaseline = parseIds(next(), '--screen-baseline')[0]!
        break
      case '--noise-ev': {
        const n = Number(next())
        if (!Number.isFinite(n) || n < 0) fail('--noise-ev expects a non-negative number')
        o.noiseEv = n
        break
      }
      case '--maker-only':
        o.makerOnly = true
        break
      case '--json':
        o.json = true
        break
      default:
        fail(`unknown flag '${flag}' — see header comment for usage`)
    }
  }
  if (o.fullRun === undefined) fail('--full-run is required')
  if ((o.screenRun === undefined) !== (o.screenBaseline === undefined))
    fail('--screen-run and --screen-baseline must be given together')
  return o
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type WindowStats = {
  markets: number
  played: number
  pnl: number
  invested: number
  evPerMarketTotal: number | null
  profitPer100: number | null
  makerTrades: number
  takerTrades: number
}

function windowStats(rows: MarketRow[]): WindowStats {
  const pnl = rows.reduce((s, r) => s + r.pnl, 0)
  const invested = rows.reduce((s, r) => s + r.cost, 0)
  return {
    markets: rows.length,
    played: rows.filter((r) => r.pnl !== 0).length,
    pnl: round2(pnl),
    invested: round2(invested),
    evPerMarketTotal: rows.length > 0 ? round4(pnl / rows.length) : null,
    profitPer100: invested > 0 ? round4((100 * pnl) / invested) : null,
    makerTrades: rows.reduce((s, r) => s + r.tradeAsMaker, 0),
    takerTrades: rows.reduce((s, r) => s + r.tradeAsTaker, 0),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function intersectBySlug(runs: MarketRow[][]): Set<string> {
  let common: Set<string> | null = null
  for (const rows of runs) {
    const slugs = new Set(rows.map((r) => r.slug))
    common = common === null ? slugs : new Set([...common].filter((s) => slugs.has(s)))
  }
  return common ?? new Set()
}

type Verdict = 'PASS' | 'FAIL' | 'NA'

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2))
  const conn = await openDb()
  try {
    const allIds = [
      o.fullRun!,
      ...(o.sweepRuns ?? []),
      ...(o.screenRun !== undefined ? [o.screenRun, o.screenBaseline!] : []),
    ]
    const identities = await fetchRunsByIds(conn, [...new Set(allIds)])
    const byId = new Map(identities.map((r) => [r.runId, r]))
    for (const id of allIds) if (!byId.has(id)) fail(`run ${id} not found in backtest_runs`)

    const full = byId.get(o.fullRun!)!
    const warnings: string[] = []

    // ---- MECHANICAL --------------------------------------------------------
    const mechanicalIssues: string[] = []
    const unitsById = new Map<number, Units>()
    const shasById = new Map<number, string[]>()
    const canonParams = (p: Record<string, unknown>): string =>
      JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b))))
    const fullParams = canonParams(full.params)
    // The screen BASELINE is a different variant by design (family/champion
    // reference) — the M1 identity checks exempt it; run-health checks do not.
    const identityExempt = new Set(o.screenBaseline !== undefined ? [o.screenBaseline] : [])
    for (const r of identities) {
      const u = await fetchUnits(conn, r.runId)
      unitsById.set(r.runId, u)
      const shas = await fetchDistinctCommitShas(conn, r.runId)
      shasById.set(r.runId, shas)
      if (shas.length > 1)
        mechanicalIssues.push(
          `run ${r.runId}: ${shas.length} distinct engine SHAs WITHIN one run (${shas.join(', ')}) — fleet SHA gating should make this impossible`,
        )
      if (r.status !== 'completed') mechanicalIssues.push(`run ${r.runId}: status=${r.status}`)
      if (r.failuresCount > 0) mechanicalIssues.push(`run ${r.runId}: failures=${r.failuresCount}`)
      if (!u.unitsValid) mechanicalIssues.push(`run ${r.runId}: UNITS-INVALID (split_cost != 0)`)
      if (r.latencyDelayMs === null)
        mechanicalIssues.push(`run ${r.runId}: ENV-SOURCED latency (not RULES-grade evidence)`)
      if (identityExempt.has(r.runId)) continue
      if (r.strategy !== full.strategy)
        mechanicalIssues.push(`run ${r.runId}: strategy ${r.strategy} != full run's ${full.strategy}`)
      else if (canonParams(r.params) !== fullParams)
        mechanicalIssues.push(
          `run ${r.runId}: params ${JSON.stringify(r.params)} != full run's ${JSON.stringify(full.params)} — stage verdicts must come from ONE config (M1)`,
        )
    }
    // M1: the screen delta is meaningless unless the pair shares one latency.
    if (o.screenRun !== undefined) {
      const s = byId.get(o.screenRun)!
      const b = byId.get(o.screenBaseline!)!
      if (s.latencyDelayMs !== b.latencyDelayMs || s.latencyJitterMs !== b.latencyJitterMs)
        mechanicalIssues.push(
          `screen pair latency mismatch: run ${s.runId} ${s.latencyDelayMs}/${s.latencyJitterMs}ms vs baseline ${b.runId} ${b.latencyDelayMs}/${b.latencyJitterMs}ms (M1)`,
        )
    }
    // M4: cross-run engine drift is a warning, not a fail — launcher-level
    // engine commits are common and benign; the reader decides.
    const allShas = [...new Set([...shasById.values()].flat())]
    if (allShas.length > 1)
      warnings.push(
        `engine SHA differs across compared runs (${allShas.join(', ')}) — check for semantic engine drift (fill model / fees / tick semantics) before trusting cross-run deltas (M4)`,
      )

    // ---- S2 FULL + TEMPORAL ------------------------------------------------
    const fullMarkets = await fetchMarkets(conn, full.runId)
    const fullStats = windowStats(fullMarkets)
    const headline = await fetchHeadline(conn, full.runId)
    const evFull = toNum(headline?.ev_per_market_total)
    const per100 = fullMarkets.filter((m) => m.cost > 0).map((m) => (100 * m.pnl) / m.cost)

    const weeklyAll = await fetchSegments(conn, full.runId, 'weekly')
    const weekly = weeklyAll.filter((s) => Number(s.markets_total) >= WEEKLY_MIN_MARKETS)
    const wf = computeWalkForwardForRun({
      segments: weekly.map((s) => ({
        batch_stats: {
          evPerMarketTotal: toNum(s.ev_per_market_total) ?? 0,
          totalFeesPaid: toNum(s.total_fees_paid) ?? 0,
          marketsTotal: Number(s.markets_total),
        },
      })),
    })
    const monthly = (await fetchSegments(conn, full.runId, 'monthly')).map((s) => ({
      month: String(s.segment_key),
      ev: toNum(s.ev_per_market_total),
      markets: Number(s.markets_total),
    }))
    const fullVerdict: Verdict =
      evFull !== null && evFull > 0 && wf.stabilityPass && wf.wfMeanEv > 0 ? 'PASS' : 'FAIL'
    const fullReasons: string[] = []
    if (evFull === null || evFull <= 0) fullReasons.push(`full-run ev ${evFull} <= 0`)
    if (!wf.stabilityPass)
      fullReasons.push(
        `walk-forward stability gate FAIL (segments=${wf.segmentCount} minEv=${round4(wf.minEv)} tailPositive=${wf.tailPositivePct})`,
      )
    if (wf.wfMeanEv <= 0) fullReasons.push(`wfMeanEv ${round4(wf.wfMeanEv)} <= 0`)

    // ---- S1 SCREEN ---------------------------------------------------------
    let screen: Record<string, unknown> | null = null
    let screenVerdict: Verdict = 'NA'
    let screenVariantStats: WindowStats | null = null
    if (o.screenRun !== undefined) {
      const sRows = await fetchMarkets(conn, o.screenRun)
      const bRows = await fetchMarkets(conn, o.screenBaseline!)
      screenVariantStats = windowStats(sRows)
      const common = intersectBySlug([sRows, bRows])
      const s = windowStats(sRows.filter((r) => common.has(r.slug)))
      const b = windowStats(bRows.filter((r) => common.has(r.slug)))
      const noise = o.noiseEv ?? DEFAULT_NOISE_EV
      const threshold = Math.max(2 * noise, SCREEN_MIN_DELTA)
      const delta =
        s.evPerMarketTotal !== null && b.evPerMarketTotal !== null
          ? round4(s.evPerMarketTotal - b.evPerMarketTotal)
          : null
      let call: string
      if (delta === null || common.size === 0) {
        call = 'NO-DATA'
        screenVerdict = 'FAIL'
      } else if (s.evPerMarketTotal! > 0 || delta > threshold) {
        call = 'ADVANCE'
        screenVerdict = 'PASS'
      } else if (delta < -threshold) {
        call = 'KILL'
        screenVerdict = 'FAIL'
      } else {
        call = 'INDISTINGUISHABLE — iterate; prefer the simpler variant'
        screenVerdict = 'FAIL'
      }
      screen = {
        screenRun: o.screenRun,
        baselineRun: o.screenBaseline,
        commonMarkets: common.size,
        evScreen: s.evPerMarketTotal,
        evBaseline: b.evPerMarketTotal,
        deltaEv: delta,
        threshold,
        call,
      }
    }

    // m6 (--maker-only): a maker-only design showing >2% taker fills at the
    // live base latency is mis-implemented, not unlucky (run 862 finding).
    // Applies to base-latency runs only — sweep runs legitimately drift taker
    // as latency grows (E-003).
    if (o.makerOnly) {
      const checks: Array<[string, WindowStats]> = [[`full run ${full.runId}`, fullStats]]
      if (screenVariantStats !== null)
        checks.push([`screen run ${o.screenRun}`, screenVariantStats])
      for (const [what, st] of checks) {
        const trades = st.makerTrades + st.takerTrades
        const share = trades > 0 ? st.takerTrades / trades : 0
        if (share > MAKER_ONLY_MAX_TAKER_SHARE)
          mechanicalIssues.push(
            `${what}: taker share ${round4(share)} > ${MAKER_ONLY_MAX_TAKER_SHARE} for a --maker-only design (m6)`,
          )
      }
    }
    const mechanical: Verdict = mechanicalIssues.length === 0 ? 'PASS' : 'FAIL'

    // ---- S3 SWEEP ----------------------------------------------------------
    let sweep: Record<string, unknown> | null = null
    let sweepVerdict: Verdict = 'NA'
    if (o.sweepRuns && o.sweepRuns.length >= 2) {
      const runsRows = await Promise.all(o.sweepRuns.map((id) => fetchMarkets(conn, id)))
      const common = intersectBySlug(runsRows)
      const rows = o.sweepRuns
        .map((id, i) => {
          const ident = byId.get(id)!
          const st = windowStats(runsRows[i]!.filter((r) => common.has(r.slug)))
          const trades = st.makerTrades + st.takerTrades
          return {
            runId: id,
            latencyMs: ident.latencyDelayMs,
            ev: st.evPerMarketTotal,
            profitPer100: st.profitPer100,
            takerShare: trades > 0 ? round4(st.takerTrades / trades) : null,
          }
        })
        .sort((a, b) => (a.latencyMs ?? 0) - (b.latencyMs ?? 0))
      const base = rows.find((r) => r.latencyMs === BASE_LATENCY_MS)
      const reasons: string[] = []
      if (!base) reasons.push(`no sweep run at the ${BASE_LATENCY_MS}ms live baseline`)
      else if (base.ev === null || base.ev <= 0)
        reasons.push(`ev(${BASE_LATENCY_MS}) ${base.ev} <= 0 — sweep gate NA on a negative base`)
      else {
        for (const r of rows) {
          if (r.ev === null || r.ev <= 0) reasons.push(`ev(${r.latencyMs}) ${r.ev} <= 0`)
          else if (r.ev < SWEEP_RETENTION * base.ev)
            reasons.push(`ev(${r.latencyMs}) ${r.ev} < ${SWEEP_RETENTION}×ev(${BASE_LATENCY_MS})`)
        }
      }
      const takerTrend =
        rows.length >= 2 &&
        rows[0]!.takerShare !== null &&
        rows[rows.length - 1]!.takerShare !== null &&
        rows[rows.length - 1]!.takerShare! > rows[0]!.takerShare! + SWEEP_TAKER_RISE_PP
      // m6: a rising taker trend is latency-dependence in disguise — it now
      // FAILS the sweep (was a print-only warning).
      if (takerTrend)
        reasons.push(
          `taker share rises >${SWEEP_TAKER_RISE_PP * 100}pp from ${BASE_LATENCY_MS}ms to max latency — hidden latency-dependence (m6)`,
        )
      sweepVerdict =
        base && base.ev !== null && base.ev > 0 ? (reasons.length === 0 ? 'PASS' : 'FAIL') : 'NA'
      sweep = {
        commonMarkets: common.size,
        rows,
        takerShareRisingWithLatency: takerTrend,
        reasons,
      }
    }

    // ---- S4 OOS ------------------------------------------------------------
    let oos: Record<string, unknown> | null = null
    let oosVerdict: Verdict = 'NA'
    if (o.designTs !== undefined) {
      // M2: an honest design-ts cannot postdate the first completed run of
      // the exact config — a config cannot run before it was designed.
      const first = await fetchEarliestRunForConfig(conn, full.strategy, full.params)
      if (first && o.designTs > Date.parse(first.createdAt))
        warnings.push(
          `--design-ts ${new Date(o.designTs).toISOString()} is AFTER the earliest completed run of this exact config (run ${first.runId} @ ${first.createdAt}) — stale/copied design-ts? The OOS split is suspect (M2)`,
        )

      const oosRows = fullMarkets.filter((m) => m.marketStartMs > o.designTs!)
      const inRows = fullMarkets.filter((m) => m.marketStartMs <= o.designTs!)
      const os = windowStats(oosRows)
      const is = windowStats(inRows)
      // M3: bare ev>0 passes a zero-edge variant ~50% of the time at n=400.
      // Champion bar = ev > OOS_SE_MULTIPLE × SE(n) (SE from per-market pnl sd).
      const n = oosRows.length
      const mean = n > 0 ? oosRows.reduce((a, m) => a + m.pnl, 0) / n : 0
      const sd =
        n > 1 ? Math.sqrt(oosRows.reduce((a, m) => a + (m.pnl - mean) ** 2, 0) / (n - 1)) : null
      const se = sd !== null ? sd / Math.sqrt(n) : null
      const championEvMin = se !== null ? round4(OOS_SE_MULTIPLE * se) : null
      const eligible =
        os.markets >= OOS_MIN_MARKETS &&
        os.evPerMarketTotal !== null &&
        championEvMin !== null &&
        os.evPerMarketTotal > championEvMin &&
        os.profitPer100 !== null &&
        os.profitPer100 > 0
      oosVerdict = eligible ? 'PASS' : 'FAIL'
      oos = {
        designTs: new Date(o.designTs).toISOString(),
        inSample: is,
        outOfSample: os,
        minMarkets: OOS_MIN_MARKETS,
        pnlSd: sd !== null ? round4(sd) : null,
        pnlSe: se !== null ? round4(se) : null,
        championEvMin,
        note:
          os.markets < OOS_MIN_MARKETS
            ? `OOS has ${os.markets} < ${OOS_MIN_MARKETS} markets — wait ~${Math.ceil((OOS_MIN_MARKETS - os.markets) / 96)} more days or re-run FULL later`
            : os.evPerMarketTotal !== null &&
                championEvMin !== null &&
                os.evPerMarketTotal > 0 &&
                os.evPerMarketTotal <= championEvMin
              ? `OOS ev ${os.evPerMarketTotal} is positive but ≤ ${OOS_SE_MULTIPLE}×SE(${n}) = ${championEvMin} — indistinguishable from zero edge at this n (M3)`
              : null,
      }
    }

    // ---- Overall -----------------------------------------------------------
    let overall: string
    if (mechanical === 'FAIL') overall = 'MECHANICAL-FAIL'
    else if (screenVerdict === 'FAIL') overall = 'FAILS-S1-SCREEN'
    else if (fullVerdict === 'FAIL') overall = 'FAILS-S2-FULL (kill or iterate per family grid)'
    else if (sweepVerdict === 'FAIL') overall = 'FAILS-S3-SWEEP (latency-dependent)'
    else if (sweepVerdict === 'NA') overall = 'CANDIDATE-PENDING-SWEEP'
    else if (oosVerdict === 'PASS') overall = 'CHAMPION-ELIGIBLE'
    else if (oosVerdict === 'FAIL') overall = 'CANDIDATE (OOS not yet passed)'
    else overall = 'CANDIDATE (provide --design-ts for OOS)'

    const result = {
      strategy: full.strategy,
      params: full.params,
      fullRun: {
        runId: full.runId,
        latency: `${full.latencyDelayMs}/${full.latencyJitterMs}ms`,
        markets: fullStats.markets,
        ev: evFull,
        pnl: fullStats.pnl,
        invested: fullStats.invested,
        profitPer100: fullStats.profitPer100,
        per100Median: per100.length > 0 ? round4(quantile(per100, 0.5)!) : null,
        per100P10: per100.length > 0 ? round4(quantile(per100, 0.1)!) : null,
        per100P90: per100.length > 0 ? round4(quantile(per100, 0.9)!) : null,
      },
      stages: {
        mechanical: { verdict: mechanical, issues: mechanicalIssues },
        s1Screen: { verdict: screenVerdict, ...(screen ?? {}) },
        s2Full: {
          verdict: fullVerdict,
          reasons: fullReasons,
          walkForward: {
            weeklySegmentsUsed: weekly.length,
            weeklySegmentsDroppedPartial: weeklyAll.length - weekly.length,
            wfMeanEv: round4(wf.wfMeanEv),
            minEv: round4(wf.minEv),
            tailPositivePct: wf.tailPositivePct,
            tailMeanEv: round4(wf.tailMeanEv),
            stabilityPass: wf.stabilityPass,
            foldMode: wf.foldMode,
          },
          monthly,
        },
        s3Sweep: { verdict: sweepVerdict, ...(sweep ?? {}) },
        s4Oos: { verdict: oosVerdict, ...(oos ?? {}) },
      },
      engineShasByRun: Object.fromEntries(shasById),
      warnings,
      overall,
    }

    if (o.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`evaluate ${full.strategy} — full run ${full.runId} (${result.fullRun.latency}, ${fullStats.markets} markets)`)
      console.log(`  params: ${JSON.stringify(full.params)}`)
      console.log(
        `  headline: ev=${evFull}  pnl=${fullStats.pnl}  invested=${fullStats.invested}  p/100=${fullStats.profitPer100}  (median=${result.fullRun.per100Median} p10=${result.fullRun.per100P10} p90=${result.fullRun.per100P90})`,
      )
      console.log(`  MECHANICAL: ${mechanical}${mechanicalIssues.length ? ' — ' + mechanicalIssues.join('; ') : ''}`)
      if (screen) {
        console.log(
          `  S1 SCREEN: ${screenVerdict} — ${String(screen.call)} (Δev=${screen.deltaEv} vs threshold ±${screen.threshold}, common=${screen.commonMarkets})`,
        )
      } else console.log('  S1 SCREEN: NA (no --screen-run)')
      console.log(
        `  S2 FULL: ${fullVerdict}${fullReasons.length ? ' — ' + fullReasons.join('; ') : ''}`,
      )
      console.log(
        `    walk-forward: weekly used=${weekly.length} (dropped ${weeklyAll.length - weekly.length} partial)  wfMeanEv=${round4(wf.wfMeanEv)}  minEv=${round4(wf.minEv)}  tail+=${wf.tailPositivePct}  stability=${wf.stabilityPass}  fold=${wf.foldMode}`,
      )
      console.log(`    monthly ev: ${monthly.map((m) => `${m.month}=${m.ev}`).join('  ')}`)
      if (sweep) {
        console.log(`  S3 SWEEP: ${sweepVerdict} (common=${sweep.commonMarkets})`)
        for (const r of sweep.rows as Array<Record<string, unknown>>)
          console.log(
            `    ${r.latencyMs}ms  run=${r.runId}  ev=${r.ev}  p/100=${r.profitPer100}  takerShare=${r.takerShare}`,
          )
        const reasons = sweep.reasons as string[]
        if (reasons.length) console.log(`    notes: ${reasons.join('; ')}`)
        if (sweep.takerShareRisingWithLatency)
          console.log('    WARNING: taker share rises with latency — hidden latency-dependence, investigate')
      } else console.log('  S3 SWEEP: NA (no --sweep-runs)')
      if (oos) {
        const os = oos.outOfSample as WindowStats
        console.log(
          `  S4 OOS: ${oosVerdict} — post ${String(oos.designTs)}: n=${os.markets} ev=${os.evPerMarketTotal} p/100=${os.profitPer100}${oos.note ? ' — ' + String(oos.note) : ''}`,
        )
      } else console.log('  S4 OOS: NA (no --design-ts)')
      if (oos && oos.pnlSe !== null)
        console.log(
          `    OOS noise: pnl sd=${oos.pnlSd} SE=${oos.pnlSe} → champion needs ev > ${oos.championEvMin} (${OOS_SE_MULTIPLE}×SE, M3)`,
        )
      for (const w of warnings) console.log(`  WARNING: ${w}`)
      console.log(`  OVERALL: ${overall}`)
    }
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error('[evaluate] fatal:', err)
  process.exit(1)
})
