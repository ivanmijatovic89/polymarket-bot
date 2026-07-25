/**
 * Pure comparison logic for the feeds parity harness (`feeds:parity`).
 *
 * Inputs are JSONL logs written by `feedsParityProbe.v1` — one from a LIVE
 * trading-bot session, one from a REPLAY of the parallel recording. Both are
 * reduced to per-feed step-function timelines on the probe's "seen" clock
 * (live: Date.now() at tick entry; replay: the recorded local receive time),
 * then compared three ways:
 *
 *  1. value agreement on a fixed grid (per-second sampling of both step
 *     functions inside the overlap window),
 *  2. boundary lag — for each value TRANSITION in live, the signed time
 *     offset to the matching transition in replay (the tuning signal: a
 *     positive mean = replay sees changes later than live → lower the
 *     corresponding BACKTEST_*_LATENCY_MS),
 *  3. first-seen timing (priceToBeat key appearance).
 *
 * Everything here is deterministic and side-effect-free so it can be unit
 * tested with synthetic fixtures.
 */

export type ParityRow = {
  v: 1
  mode: 'live' | 'parquet'
  /** The probe's wall clock for this tick (live: Date.now(); replay: tsLocalMs ?? exchange ts). */
  seenAtMs: number
  exchangeTsMs: number
  slug?: string
  /** Tick event type ('book' | 'price_change' | synthetic kinds); absent in pre-feature rows. */
  eventType?: string
  /** Present (true) only on synthetic feed ticks. */
  synthetic?: boolean
  binance?: { tsMs: number; value: number }
  chainlink?: { tsMs: number; value: number }
  ptb?: { openPrice: number; receivedAtMs: number }
  /** Top-of-book per asset id at this tick. */
  books?: Array<{ assetId: string; bid: number | null; ask: number | null }>
}

export type FeedKey = 'binance' | 'chainlink'

/** Tolerant JSONL parse: skips blank/torn lines and rows with a wrong version. */
export function parseParityJsonl(text: string): ParityRow[] {
  const out: ParityRow[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line) as ParityRow
      if (o && o.v === 1 && Number.isFinite(o.seenAtMs)) out.push(o)
    } catch {
      // torn tail line etc.
    }
  }
  out.sort((a, b) => a.seenAtMs - b.seenAtMs)
  return out
}

export type TimelinePoint = { atMs: number; value: number | null }

/**
 * Step-function of a feed's value over the probe clock: one point per CHANGE
 * (including appearance/disappearance of the key). `null` = key absent.
 */
export function buildTimeline(rows: ParityRow[], feed: FeedKey): TimelinePoint[] {
  const points: TimelinePoint[] = []
  let last: number | null | undefined
  for (const r of rows) {
    const value = r[feed]?.value ?? null
    if (value !== last) {
      points.push({ atMs: r.seenAtMs, value })
      last = value
    }
  }
  return points
}

/** Value of a step function at time t (null before the first point). */
export function valueAt(tl: TimelinePoint[], tMs: number): number | null {
  // Binary search: last point with atMs <= tMs.
  let lo = 0
  let hi = tl.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (tl[mid]!.atMs <= tMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans >= 0 ? tl[ans]!.value : null
}

export function overlapWindow(
  a: ParityRow[],
  b: ParityRow[],
): { fromMs: number; toMs: number } | null {
  if (a.length === 0 || b.length === 0) return null
  const fromMs = Math.max(a[0]!.seenAtMs, b[0]!.seenAtMs)
  const toMs = Math.min(a[a.length - 1]!.seenAtMs, b[b.length - 1]!.seenAtMs)
  return toMs > fromMs ? { fromMs, toMs } : null
}

export type GridAgreement = { agree: number; total: number; pct: number }

/** Sample both step functions on a fixed grid; equal (incl. both-null) counts as agreement. */
export function gridAgreement(
  tlA: TimelinePoint[],
  tlB: TimelinePoint[],
  fromMs: number,
  toMs: number,
  stepMs = 1000,
): GridAgreement {
  let agree = 0
  let total = 0
  for (let t = fromMs; t <= toMs; t += stepMs) {
    total++
    if (valueAt(tlA, t) === valueAt(tlB, t)) agree++
  }
  return { agree, total, pct: total > 0 ? (agree / total) * 100 : 0 }
}

export type BoundaryLagResult = {
  matched: Array<{ liveAtMs: number; dtMs: number; value: number }>
  unmatchedLive: number
  unmatchedReplay: number
  stats: { count: number; meanMs: number; p50Ms: number; p90Ms: number; p99Ms: number } | null
}

function quantile(sortedVals: number[], q: number): number {
  if (sortedVals.length === 0) return NaN
  const idx = (sortedVals.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedVals[lo]!
  return sortedVals[lo]! + (sortedVals[hi]! - sortedVals[lo]!) * (idx - lo)
}

/**
 * Match each live value-transition to the nearest replay transition TO THE
 * SAME VALUE within ±windowMs (each replay transition used at most once,
 * greedy in live order). dtMs = replayAt − liveAt: positive = replay later.
 */
export function boundaryLag(
  tlLive: TimelinePoint[],
  tlReplay: TimelinePoint[],
  fromMs: number,
  toMs: number,
  windowMs = 5_000,
): BoundaryLagResult {
  const liveTrans = tlLive.filter((p) => p.value !== null && p.atMs >= fromMs && p.atMs <= toMs)
  const replayTrans = tlReplay.filter(
    (p) => p.value !== null && p.atMs >= fromMs - windowMs && p.atMs <= toMs + windowMs,
  )
  const usedReplay = new Set<number>()
  const matched: Array<{ liveAtMs: number; dtMs: number; value: number }> = []
  for (const lt of liveTrans) {
    let best = -1
    let bestDt = Number.POSITIVE_INFINITY
    for (let i = 0; i < replayTrans.length; i++) {
      if (usedReplay.has(i)) continue
      const rt = replayTrans[i]!
      if (rt.value !== lt.value) continue
      const dt = rt.atMs - lt.atMs
      if (Math.abs(dt) > windowMs) continue
      if (Math.abs(dt) < Math.abs(bestDt)) {
        best = i
        bestDt = dt
      }
    }
    if (best >= 0) {
      usedReplay.add(best)
      matched.push({ liveAtMs: lt.atMs, dtMs: bestDt, value: lt.value! })
    }
  }
  const unmatchedLive = liveTrans.length - matched.length
  const replayInWindow = replayTrans.filter((p) => p.atMs >= fromMs && p.atMs <= toMs).length
  const unmatchedReplay = Math.max(0, replayInWindow - matched.length)
  let stats: BoundaryLagResult['stats'] = null
  if (matched.length > 0) {
    const dts = matched.map((m) => m.dtMs).sort((a, b) => a - b)
    stats = {
      count: dts.length,
      meanMs: dts.reduce((s, x) => s + x, 0) / dts.length,
      p50Ms: quantile(dts, 0.5),
      p90Ms: quantile(dts, 0.9),
      p99Ms: quantile(dts, 0.99),
    }
  }
  return { matched, unmatchedLive, unmatchedReplay, stats }
}

/** First time the priceToBeat key is present; null if never. */
export function ptbFirstSeen(rows: ParityRow[]): number | null {
  for (const r of rows) if (r.ptb) return r.seenAtMs
  return null
}

export type BookAgreement = { agree: number; total: number; pct: number }

/**
 * Top-of-book agreement aligned on the EXCHANGE timestamp (the same book
 * state exists on both sides when both connections applied the same message):
 * for exchange timestamps present in both logs, compare (bid, ask) per asset.
 */
export function bookAgreement(live: ParityRow[], replay: ParityRow[]): BookAgreement {
  const key = (r: ParityRow): string => String(r.exchangeTsMs)
  const replayByTs = new Map<string, ParityRow>()
  for (const r of replay) if (r.books) replayByTs.set(key(r), r)
  let agree = 0
  let total = 0
  for (const l of live) {
    if (!l.books) continue
    const r = replayByTs.get(key(l))
    if (!r?.books) continue
    total++
    const rBooks = new Map(r.books.map((b) => [b.assetId, b]))
    const equal = l.books.every((lb) => {
      const rb = rBooks.get(lb.assetId)
      return rb !== undefined && rb.bid === lb.bid && rb.ask === lb.ask
    })
    if (equal) agree++
  }
  return { agree, total, pct: total > 0 ? (agree / total) * 100 : 0 }
}

export type FeedParityReport = {
  agreement: GridAgreement
  lag: Omit<BoundaryLagResult, 'matched'> & { matchedCount: number }
  suggestion: { env: string; currentMs: number; suggestedMs: number } | null
}

export type ParityReport = {
  overlap: { fromMs: number; toMs: number; minutes: number }
  rows: { live: number; replay: number }
  binance: FeedParityReport
  chainlink: FeedParityReport
  ptb: { liveFirstSeenMs: number | null; replayFirstSeenMs: number | null; dtMs: number | null }
  book: BookAgreement
  /** Synthetic feed tick counts inside the overlap (null when neither side has any). */
  syntheticTicks: {
    live: number
    replay: number
    backwardTimeLive: number
    backwardTimeReplay: number
  } | null
}

/**
 * Full report. `currentLatency` carries the env values the replay ran with so
 * suggestions are anchored to them: suggested = max(0, current − meanBias)
 * (replay later than live by the mean bias ⇒ decrease the visibility offset).
 */
export function compareParityLogs(args: {
  live: ParityRow[]
  replay: ParityRow[]
  currentLatency: { binanceMs: number; chainlinkMs: number }
  gridStepMs?: number
  lagWindowMs?: number
}): ParityReport | null {
  const ov = overlapWindow(args.live, args.replay)
  if (!ov) return null
  const feedReport = (feed: FeedKey, env: string, currentMs: number): FeedParityReport => {
    const tlL = buildTimeline(args.live, feed)
    const tlR = buildTimeline(args.replay, feed)
    const agreement = gridAgreement(tlL, tlR, ov.fromMs, ov.toMs, args.gridStepMs ?? 1000)
    const lag = boundaryLag(tlL, tlR, ov.fromMs, ov.toMs, args.lagWindowMs ?? 5_000)
    const suggestion = lag.stats
      ? {
          env,
          currentMs,
          suggestedMs: Math.max(0, Math.round(currentMs - lag.stats.meanMs)),
        }
      : null
    return {
      agreement,
      lag: {
        unmatchedLive: lag.unmatchedLive,
        unmatchedReplay: lag.unmatchedReplay,
        stats: lag.stats,
        matchedCount: lag.matched.length,
      },
      suggestion,
    }
  }
  const liveFirst = ptbFirstSeen(args.live)
  const replayFirst = ptbFirstSeen(args.replay)
  const syntheticCounts = (rows: ParityRow[]): { n: number; backward: number } => {
    let n = 0
    let backward = 0
    // Backwardness keys on exchangeTsMs — the field the monotone clamp
    // stamps — so a clamp regression is actually observable here.
    let prevExchange = Number.NEGATIVE_INFINITY
    for (const r of rows) {
      if (r.seenAtMs < ov.fromMs || r.seenAtMs > ov.toMs) continue
      if (r.synthetic === true) {
        n += 1
        if (r.exchangeTsMs < prevExchange) backward += 1
      }
      prevExchange = r.exchangeTsMs
    }
    return { n, backward }
  }
  const synL = syntheticCounts(args.live)
  const synR = syntheticCounts(args.replay)
  return {
    overlap: { ...ov, minutes: (ov.toMs - ov.fromMs) / 60_000 },
    rows: { live: args.live.length, replay: args.replay.length },
    binance: feedReport(
      'binance',
      'BACKTEST_BINANCE_FEED_LATENCY_MS',
      args.currentLatency.binanceMs,
    ),
    chainlink: feedReport(
      'chainlink',
      'BACKTEST_RTDS_CHAINLINK_LATENCY_MS',
      args.currentLatency.chainlinkMs,
    ),
    ptb: {
      liveFirstSeenMs: liveFirst,
      replayFirstSeenMs: replayFirst,
      dtMs: liveFirst !== null && replayFirst !== null ? replayFirst - liveFirst : null,
    },
    book: bookAgreement(args.live, args.replay),
    syntheticTicks:
      synL.n > 0 || synR.n > 0
        ? {
            live: synL.n,
            replay: synR.n,
            backwardTimeLive: synL.backward,
            backwardTimeReplay: synR.backward,
          }
        : null,
  }
}
