import { reasonCode } from './diff.js'
import type { TraceRecord } from './trace.js'

/**
 * Feature coverage of one trace (60 §5.6): which engine paths a market
 * actually hit. Generic counters work for any strategy; the exerciser
 * checklist maps the schedule (60 §5.2–§5.4) onto observed records; feed
 * coverage counts what the feed exerciser saw (60 §5.8).
 */

export type GenericCoverage = {
  ticks: number
  syntheticTicks: number
  intents: number
  cascades: number
  takerFills: number
  makerFills: number
  killed: number
  rejected: number
  expired: number
  canceled: number
  cancelFailed: number
  splits: number
  merges: number
  settlementUpdates: number
  pnl: number | null
}

/** Feature class (60 §5.6): D = deterministic once a best price exists, L = liquidity-dependent. */
export type FeatureClass = 'D' | 'L'

/** v1 features (salvaged `coverage.ts:26-50`, 60 §5.6) with their class. */
export const EXERCISER_FEATURES_V1 = {
  'x1 post-only rests': 'D',
  'x2 FOK filled': 'L',
  'x2 FOK killed': 'L',
  'cascade x2-exit': 'L',
  split: 'D',
  'x3 GTD rests': 'D',
  'GTD expired': 'L',
  'x4 batch rests': 'D',
  'cancel_order x1': 'D',
  'x5 taker fill': 'L',
  'x5 remainder rests': 'L',
  'x5 maker fill': 'L',
  'x6 FOK killed': 'L',
  'x7 post-only rejected': 'D',
  'cancel_batch cancels': 'D',
  'cancel_batch cancel_failed': 'D',
  merge: 'D',
  'cancel_market cancels': 'L',
  'x8 crossing sell fill': 'L',
  'cancel_all cancels': 'L',
  'periodic placed': 'D',
  'periodic canceled': 'D',
  'periodic maker fill': 'L',
} as const satisfies Record<string, FeatureClass>

/** v2 additions (60 §5.6) with their class. */
export const EXERCISER_FEATURES_V2_ADDED = {
  'x9s status-gated': 'L',
  'x10 replacement rests': 'D',
  'x10 old generation canceled': 'D',
  'x10 re-place dropped': 'D',
  'x11 order_submitted cascade': 'D',
  'x11-sib cascade cancel': 'D',
  'x12 place-then-cancel': 'D',
  'b15 accepted': 'D',
  'b16 over cap': 'D',
  'cancel_batch mixed': 'D',
  'merge zero': 'D',
  'split insufficient': 'D',
  'merge clamp': 'D',
  'x13 insufficient capital': 'D',
  'x13-retry cascade': 'D',
  'cancel terminal': 'D',
  'cancel unknown': 'D',
  'x16 partial batch': 'D',
  'x14 oversell': 'L',
  'cancel_market by market': 'D',
  'x15 gtd too soon': 'D',
  'x17 gtd no expiry': 'D',
  'x18 post-only market order': 'D',
  'x19 invalid price': 'D',
  'x20 invalid size': 'D',
  'intentMeta populated': 'L',
} as const satisfies Record<string, FeatureClass>

export type ExerciserFeatureV1 = keyof typeof EXERCISER_FEATURES_V1
export type ExerciserFeature = ExerciserFeatureV1 | keyof typeof EXERCISER_FEATURES_V2_ADDED

/** The feature list of an exerciser schedule version (60 §5.7: the coverage list moves with the version). */
export function exerciserFeatures(version: number): Record<string, FeatureClass> {
  if (version === 1) return { ...EXERCISER_FEATURES_V1 }
  if (version === 2) return { ...EXERCISER_FEATURES_V1, ...EXERCISER_FEATURES_V2_ADDED }
  throw new Error(`unknown exerciser schedule version ${version}`)
}

/** Incremental generic coverage (one pass over a streamed trace). */
export class GenericCoverageAcc {
  readonly c: GenericCoverage = {
    ticks: 0,
    syntheticTicks: 0,
    intents: 0,
    cascades: 0,
    takerFills: 0,
    makerFills: 0,
    killed: 0,
    rejected: 0,
    expired: 0,
    canceled: 0,
    cancelFailed: 0,
    splits: 0,
    merges: 0,
    settlementUpdates: 0,
    pnl: null,
  }

  add(r: TraceRecord): void {
    const c = this.c
    if (r.t === 'tick') {
      c.ticks++
      if (r.cause !== 'book' && r.cause !== 'price_change') c.syntheticTicks++
    } else if (r.t === 'intent') {
      c.intents++
      if (r.src === 'account') c.cascades++
    } else if (r.t === 'event') {
      if (r.kind === 'fill') {
        if (r.liquidity === 'TAKER') c.takerFills++
        else c.makerFills++
      } else if (r.kind === 'order_rejected') c.rejected++
      else if (r.kind === 'cancel_failed') c.cancelFailed++
      else if (r.kind === 'positions_split') c.splits++
      else if (r.kind === 'positions_merged') c.merges++
      else if (r.kind === 'settlement_update') c.settlementUpdates++
      else if (r.kind === 'order_done') {
        if (r.reason === 'killed') c.killed++
        else if (r.reason === 'expired') c.expired++
        else if (r.reason === 'canceled') c.canceled++
      }
    } else if (r.t === 'final') {
      const stats = r.stats as { pnl?: unknown } | null
      c.pnl = typeof stats?.pnl === 'number' ? stats.pnl : null
    }
  }
}

export function genericCoverage(records: readonly TraceRecord[]): GenericCoverage {
  const acc = new GenericCoverageAcc()
  for (const r of records) acc.add(r)
  return acc.c
}

const isPeriodic = (cid: unknown) => typeof cid === 'string' && /^r\d+$/.test(cid)

const placedCids = (x: TraceRecord): string[] =>
  x.kind === 'place_limit'
    ? [String(x.cid)]
    : x.kind === 'place_batch' && Array.isArray(x.orders)
      ? (x.orders as Array<{ cid?: unknown }>).map((o) => String(o.cid))
      : []

/** Incremental exerciser checklist (60 §5.6), one pass over a streamed trace. */
export class ExerciserCoverageAcc {
  private readonly hit = new Set<ExerciserFeature>()
  // Which intent (by kind) a cancellation belongs to: the most recent cancel intent of the tick.
  private lastCancel: string | null = null
  private readonly count = new Map<string, number>()
  private readonly x12Seqs = { place: new Set<unknown>(), cancel: new Set<unknown>() }
  private merge100k = false

  private bump(k: string): void {
    this.count.set(k, (this.count.get(k) ?? 0) + 1)
  }

  add(r: TraceRecord): void {
    const hit = this.hit
    const x12Seqs = this.x12Seqs
    const bump = (k: string) => this.bump(k)
    if (r.t === 'tick') {
      this.lastCancel = null
      return
    }
    if (r.t === 'final') {
      const meta = (r.stats as { intentMeta?: unknown } | null)?.intentMeta
      if (Array.isArray(meta) && meta.length > 0) hit.add('intentMeta populated')
      return
    }
    if (r.t === 'intent') {
      const cids = placedCids(r)
      for (const c of cids) bump(`intent:${c}`)
      if (r.src === 'account') {
        if (cids.includes('x2-exit')) hit.add('cascade x2-exit')
        if (cids.includes('x11-sib')) hit.add('x11 order_submitted cascade')
        if (cids.includes('x13-retry')) hit.add('x13-retry cascade')
        if (r.kind === 'cancel_order' && r.cid === 'x11') hit.add('x11-sib cascade cancel')
      }
      if (String(r.kind).startsWith('cancel_')) this.lastCancel = String(r.kind)
      if (cids.some(isPeriodic)) hit.add('periodic placed')
      if (cids.includes('x9s')) hit.add('x9s status-gated')
      if (cids.includes('x12')) x12Seqs.place.add(r.seq)
      if (r.kind === 'cancel_order' && r.cid === 'x12') x12Seqs.cancel.add(r.seq)
      if (r.kind === 'cancel_order' && r.cid === 'x6') hit.add('cancel terminal')
      if (r.kind === 'cancel_order' && r.cid === 'x-never') hit.add('cancel unknown')
      if (r.kind === 'place_batch' && cids.length === 16 && cids.every((c) => c.startsWith('b16-')))
        hit.add('b16 over cap')
      if (r.kind === 'cancel_batch' && Array.isArray(r.cids)) {
        const cs = r.cids.map(String)
        if (cs.some((c) => c.startsWith('b15-')) && cs.some((c) => c.startsWith('b16-')))
          hit.add('cancel_batch mixed')
      }
      if (r.kind === 'merge_positions' && r.size === 0) hit.add('merge zero')
      if (r.kind === 'merge_positions' && r.size === 100000) this.merge100k = true
      if (r.kind === 'cancel_market' && r.market !== undefined) hit.add('cancel_market by market')
      return
    }
    if (r.t !== 'event') return
    const cid = r.cid
    switch (r.kind) {
      case 'order_submitted':
        bump(`submitted:${String(cid)}`)
        if (cid === 'x14') hit.add('x14 oversell')
        break
      case 'order_accepted':
        if (typeof cid === 'string' && cid.startsWith('b15-')) bump('accepted:b15')
        break
      case 'order_open':
        if (cid === 'x1') hit.add('x1 post-only rests')
        if (cid === 'x3') hit.add('x3 GTD rests')
        if (cid === 'x4a' || cid === 'x4b') hit.add('x4 batch rests')
        if (cid === 'x5') hit.add('x5 remainder rests')
        if (cid === 'x10') bump('open:x10')
        break
      case 'fill':
        if (cid === 'x2') hit.add('x2 FOK filled')
        if (cid === 'x5') hit.add(r.liquidity === 'TAKER' ? 'x5 taker fill' : 'x5 maker fill')
        if (cid === 'x8' && r.liquidity === 'TAKER') hit.add('x8 crossing sell fill')
        if (isPeriodic(cid) && r.liquidity === 'MAKER') hit.add('periodic maker fill')
        break
      case 'order_done':
        if (r.reason === 'killed' && cid === 'x2') hit.add('x2 FOK killed')
        if (r.reason === 'killed' && cid === 'x6') hit.add('x6 FOK killed')
        if (r.reason === 'expired') hit.add('GTD expired')
        if (r.reason === 'canceled') {
          if (cid === 'x1' && this.lastCancel === 'cancel_order') hit.add('cancel_order x1')
          if (this.lastCancel === 'cancel_batch') hit.add('cancel_batch cancels')
          if (this.lastCancel === 'cancel_market') hit.add('cancel_market cancels')
          if (this.lastCancel === 'cancel_all') hit.add('cancel_all cancels')
          if (isPeriodic(cid) && this.lastCancel === 'cancel_order') hit.add('periodic canceled')
          if (cid === 'x10') hit.add('x10 old generation canceled')
        }
        break
      case 'order_rejected': {
        const code = reasonCode(r.reason)
        if (cid === 'x7') hit.add('x7 post-only rejected')
        if (cid === 'x13' && code === 'insufficient_capital') hit.add('x13 insufficient capital')
        if (cid === 'x16b') hit.add('x16 partial batch')
        if (cid === 'x15' && code === 'gtd_expireAtMs_too_soon') hit.add('x15 gtd too soon')
        if (cid === 'x17' && code === 'gtd_requires_expireAtMs') hit.add('x17 gtd no expiry')
        if (cid === 'x18' && code === 'post_only_requires_gtc_or_gtd')
          hit.add('x18 post-only market order')
        if (cid === 'x19' && code === 'invalid_price') hit.add('x19 invalid price')
        if (cid === 'x20' && code === 'invalid_size') hit.add('x20 invalid size')
        break
      }
      case 'cancel_failed':
        if (r.op === 'cancel_batch') hit.add('cancel_batch cancel_failed')
        break
      case 'positions_split':
        hit.add('split')
        break
      case 'split_failed':
        hit.add('split insufficient')
        break
      case 'positions_merged':
        hit.add('merge')
        if (this.merge100k && typeof r.size === 'number' && r.size < 100000) hit.add('merge clamp')
        break
    }
  }

  /** The features hit by the whole trace. */
  result(): Set<ExerciserFeature> {
    const hit = new Set(this.hit)
    const count = this.count
    const x12Seqs = this.x12Seqs
    if ((count.get('open:x10') ?? 0) >= 2) hit.add('x10 replacement rests')
    const x10Intents = count.get('intent:x10') ?? 0
    if (x10Intents >= 3 && (count.get('submitted:x10') ?? 0) < x10Intents)
      hit.add('x10 re-place dropped')
    if ([...x12Seqs.place].some((s) => x12Seqs.cancel.has(s))) hit.add('x12 place-then-cancel')
    if ((count.get('accepted:b15') ?? 0) >= 15) hit.add('b15 accepted')
    // 60 §5.5 x16b: rejected without order_submitted while x16a proceeds.
    if ((count.get('submitted:x16a') ?? 0) === 0 || (count.get('submitted:x16b') ?? 0) > 0)
      hit.delete('x16 partial batch')
    return hit
  }
}

/** Exerciser checklist of one trace (60 §5.6). */
export function exerciserCoverage(records: readonly TraceRecord[]): Set<ExerciserFeature> {
  const acc = new ExerciserCoverageAcc()
  for (const r of records) acc.add(r)
  return acc.result()
}

export type FeatureCoverageRow = {
  feature: string
  class: FeatureClass
  markets: number
  share: number
  /** 60 §5.6 threshold per exerciser cell: D ≥ 95% of markets, L ≥ 1 market. */
  pass: boolean
}

/** Per-cell coverage verdict against the 60 §5.6 thresholds. */
export function coverageVerdict(
  features: Record<string, FeatureClass>,
  hitsPerMarket: ReadonlyArray<ReadonlySet<string>>,
): FeatureCoverageRow[] {
  const n = hitsPerMarket.length
  return Object.entries(features).map(([feature, cls]) => {
    const markets = hitsPerMarket.filter((h) => h.has(feature)).length
    const share = n === 0 ? 0 : markets / n
    return {
      feature,
      class: cls,
      markets,
      share,
      pass: cls === 'D' ? n > 0 && share >= 0.95 : markets >= 1,
    }
  })
}

/** What the feed exerciser saw in one trace (level `feeds`, 60 §5.8, 14 V-3). */
export type FeedCoverage = {
  ticks: number
  binanceTicks: number
  chainlinkTicks: number
  priceToBeatTicks: number
  syntheticBinance: number
  syntheticChainlink: number
  /** Ticks on which each plugin snapshot key was present. */
  plugins: Record<string, number>
}

/** Incremental feed coverage, one pass over a streamed trace. */
export class FeedCoverageAcc {
  readonly c: FeedCoverage = {
    ticks: 0,
    binanceTicks: 0,
    chainlinkTicks: 0,
    priceToBeatTicks: 0,
    syntheticBinance: 0,
    syntheticChainlink: 0,
    plugins: {},
  }

  add(r: TraceRecord): void {
    const c = this.c
    if (r.t === 'tick') {
      c.ticks++
      if (r.cause === 'binance_agg_trade') c.syntheticBinance++
      if (r.cause === 'chainlink_round') c.syntheticChainlink++
    } else if (r.t === 'feeds') {
      if (r.binance) c.binanceTicks++
      if (r.chainlink) c.chainlinkTicks++
      if (r.priceToBeat) c.priceToBeatTicks++
      const plugins = r.plugins as Record<string, unknown> | undefined
      for (const id of Object.keys(plugins ?? {})) c.plugins[id] = (c.plugins[id] ?? 0) + 1
    }
  }
}

export function feedCoverage(records: readonly TraceRecord[]): FeedCoverage {
  const acc = new FeedCoverageAcc()
  for (const r of records) acc.add(r)
  return acc.c
}

/** The coverage block of a manifest market entry (60 §5.6, HR-7). */
export type MarketCoverage = {
  generic: GenericCoverage
  feeds?: FeedCoverage
  exerciser?: string[]
  /** Set when coverage counts only the records before this index (PM-4). */
  prefixRecords?: number
}

/**
 * Coverage of one TS trace fed record by record (60 §5.6): generic counters,
 * feed counters at the `feeds` level, the exerciser checklist when the cell
 * runs a schedule. With `prefixRecords`, only the records before that index
 * count: a masked market's coverage is its identical prefix (60 PM-4).
 */
export class MarketCoverageAcc {
  private readonly gen = new GenericCoverageAcc()
  private readonly fc: FeedCoverageAcc | null
  private readonly ex: ExerciserCoverageAcc | null
  private seen = 0

  constructor(
    traceLevel: 'decisions' | 'feeds',
    schedule: number | null,
    private readonly prefixRecords?: number,
  ) {
    this.fc = traceLevel === 'feeds' ? new FeedCoverageAcc() : null
    this.ex = schedule !== null ? new ExerciserCoverageAcc() : null
  }

  add(r: TraceRecord): void {
    const i = this.seen++
    if (this.prefixRecords !== undefined && i >= this.prefixRecords) return
    this.gen.add(r)
    this.fc?.add(r)
    this.ex?.add(r)
  }

  result(): MarketCoverage {
    return {
      generic: this.gen.c,
      ...(this.fc ? { feeds: this.fc.c } : {}),
      ...(this.ex ? { exerciser: [...this.ex.result()].sort() } : {}),
      ...(this.prefixRecords === undefined ? {} : { prefixRecords: this.prefixRecords }),
    }
  }
}
