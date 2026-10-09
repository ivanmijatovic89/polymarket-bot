import type { MarketOrderBooksSnapshot } from '../../market/orderbook/index.js'
import type { ReplayApplyEvent } from '../../parquet/replay/replayOrderBookForMarket.js'
import { replayTelonexDeltaParquetForMarket } from '../../parquet/replay/replayTelonexDeltaParquetForMarket.js'

/**
 * Edge-market scan for parity sets (native/spec/60-verification.md §4.2
 * MS-3): most and fewest events, crossed-book ticks, local or exchange clock
 * going backwards, deltas before the first book (the 15 §8 counters), and a
 * missing best bid or ask at window start. Read-only replay of the
 * telonex-delta file through the TS book engine.
 */

export type EdgeCounters = {
  events: number
  crossedBookTicks: number
  localClockBackwards: number
  exchangeClockBackwards: number
  deltaBeforeBook: number
  /** At the first snapshot at or after the window start, some outcome lacks a best bid or ask. */
  missingBestAtStart: boolean
}

export class EdgeCounter {
  readonly c: EdgeCounters = {
    events: 0,
    crossedBookTicks: 0,
    localClockBackwards: 0,
    exchangeClockBackwards: 0,
    deltaBeforeBook: 0,
    missingBestAtStart: false,
  }
  private lastLocal = Number.NEGATIVE_INFINITY
  private lastExchange = Number.NEGATIVE_INFINITY
  private readonly booked = new Set<string>()
  private startChecked = false

  constructor(
    private readonly windowStartMs: number,
    private readonly assets: readonly string[],
  ) {}

  observe(snap: MarketOrderBooksSnapshot, raw: Pick<ReplayApplyEvent, 'msg' | 'source'>): void {
    this.c.events++
    const local = raw.source.tsLocalMs
    if (local !== undefined) {
      if (local < this.lastLocal) this.c.localClockBackwards++
      this.lastLocal = Math.max(this.lastLocal, local)
    }
    const ex = Number((raw.msg as { timestamp?: unknown }).timestamp)
    if (Number.isFinite(ex)) {
      if (ex < this.lastExchange) this.c.exchangeClockBackwards++
      this.lastExchange = Math.max(this.lastExchange, ex)
    }
    const msg = raw.msg as {
      event_type: string
      asset_id?: string
      price_changes?: Array<{ asset_id: string }>
    }
    if (msg.event_type === 'book' && msg.asset_id) this.booked.add(msg.asset_id)
    else if (msg.event_type === 'price_change')
      for (const pc of msg.price_changes ?? [])
        if (!this.booked.has(pc.asset_id)) this.c.deltaBeforeBook++
    for (const b of Object.values(snap.byAssetId))
      if (b.bestBid !== null && b.bestAsk !== null && b.bestBid >= b.bestAsk) {
        this.c.crossedBookTicks++
        break
      }
    if (!this.startChecked && snap.timestamp >= this.windowStartMs) {
      this.startChecked = true
      this.c.missingBestAtStart = this.assets.some((a) => {
        const b = snap.byAssetId[a]
        return !b || b.bestBid === null || b.bestAsk === null
      })
    }
  }
}

export async function scanMarketEdges(
  filePath: string,
  windowStartMs: number,
  assets: readonly string[],
): Promise<EdgeCounters> {
  const counter = new EdgeCounter(windowStartMs, assets)
  await replayTelonexDeltaParquetForMarket({
    filePath,
    onSnapshot: (snap, raw) => counter.observe(snap, raw),
  })
  return counter.c
}

export type EdgeCriterion = {
  id: string
  /** Higher is more extreme; null excludes the market from this criterion. */
  score: (c: EdgeCounters) => number | null
}

/** The MS-3 criteria, in the order edge markets are taken. */
export const EDGE_CRITERIA: readonly EdgeCriterion[] = [
  { id: 'most events', score: (c) => c.events },
  { id: 'fewest events', score: (c) => -c.events },
  { id: 'crossed-book ticks', score: (c) => (c.crossedBookTicks > 0 ? c.crossedBookTicks : null) },
  {
    id: 'local clock backwards',
    score: (c) => (c.localClockBackwards > 0 ? c.localClockBackwards : null),
  },
  {
    id: 'exchange clock backwards',
    score: (c) => (c.exchangeClockBackwards > 0 ? c.exchangeClockBackwards : null),
  },
  {
    id: 'deltas before the first book',
    score: (c) => (c.deltaBeforeBook > 0 ? c.deltaBeforeBook : null),
  },
  {
    id: 'missing best bid or ask at window start',
    score: (c) => (c.missingBestAtStart ? 1 : null),
  },
]

/**
 * Pick `perCriterion` distinct markets per criterion (highest score first,
 * slug as tie-break), skipping markets already chosen; then, while fewer
 * than `minTotal` are picked (MS-3: at least 10), take further markets
 * round-robin over the criteria that still have candidates.
 */
export function pickEdgeMarkets(
  scanned: ReadonlyArray<{ slug: string; counters: EdgeCounters }>,
  perCriterion: number,
  exclude: ReadonlySet<string>,
  minTotal = 0,
): Array<{ slug: string; criterion: string; counters: EdgeCounters }> {
  const taken = new Set(exclude)
  const out: Array<{ slug: string; criterion: string; counters: EdgeCounters }> = []
  const rankings = EDGE_CRITERIA.map((crit) => ({
    crit,
    ranked: scanned
      .map((s) => ({ s, score: crit.score(s.counters) }))
      .filter((x): x is { s: (typeof scanned)[number]; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score || a.s.slug.localeCompare(b.s.slug))
      .map((x) => x.s),
    next: 0,
  }))
  const takeOne = (r: (typeof rankings)[number]): boolean => {
    while (r.next < r.ranked.length) {
      const s = r.ranked[r.next++]!
      if (taken.has(s.slug)) continue
      taken.add(s.slug)
      out.push({ slug: s.slug, criterion: r.crit.id, counters: s.counters })
      return true
    }
    return false
  }
  for (const r of rankings) for (let n = 0; n < perCriterion; n++) if (!takeOne(r)) break
  let progress = true
  while (out.length < minTotal && progress) {
    progress = false
    for (const r of rankings) {
      if (out.length >= minTotal) break
      if (takeOne(r)) progress = true
    }
  }
  return out
}

/** Criteria with no qualifying market among the scanned ones. */
export function unmatchedCriteria(scanned: ReadonlyArray<{ counters: EdgeCounters }>): string[] {
  return EDGE_CRITERIA.filter((c) => !scanned.some((s) => c.score(s.counters) !== null)).map(
    (c) => c.id,
  )
}
