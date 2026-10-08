import type { TraceRecord } from './trace.js'

/**
 * Feature coverage of one trace: which engine paths a market actually hit.
 * Generic counters work for any strategy; the `exerciser` checklist maps the
 * native/EXERCISER.md schedule onto observed outcomes.
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
  pnl: number | null
}

export const EXERCISER_FEATURES = [
  'x1 post-only rests',
  'x2 FOK filled',
  'x2 FOK killed',
  'cascade x2-exit',
  'split',
  'x3 GTD rests',
  'GTD expired',
  'x4 batch rests',
  'cancel_order x1',
  'x5 taker fill',
  'x5 remainder rests',
  'x5 maker fill',
  'x6 FOK killed',
  'x7 post-only rejected',
  'cancel_batch cancels',
  'cancel_batch cancel_failed',
  'merge',
  'cancel_market cancels',
  'x8 crossing sell fill',
  'cancel_all cancels',
  'periodic placed',
  'periodic canceled',
  'periodic maker fill',
] as const

export type ExerciserFeature = (typeof EXERCISER_FEATURES)[number]

export function genericCoverage(records: readonly TraceRecord[]): GenericCoverage {
  const c: GenericCoverage = {
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
    pnl: null,
  }
  for (const r of records) {
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
  return c
}

export function exerciserCoverage(records: readonly TraceRecord[]): Set<ExerciserFeature> {
  const hit = new Set<ExerciserFeature>()
  // Which intent (by seq + kind) a cancellation belongs to: the most recent cancel intent.
  let lastCancel: string | null = null
  const isPeriodic = (cid: unknown) => typeof cid === 'string' && /^r\d+$/.test(cid)
  for (const r of records) {
    if (r.t === 'tick') {
      lastCancel = null
      continue
    }
    if (r.t === 'intent') {
      if (r.src === 'account' && r.cid === 'x2-exit') hit.add('cascade x2-exit')
      if (String(r.kind).startsWith('cancel_')) lastCancel = String(r.kind)
      if (r.kind === 'place_limit' && isPeriodic(r.cid)) hit.add('periodic placed')
      continue
    }
    if (r.t !== 'event') continue
    const cid = r.cid
    switch (r.kind) {
      case 'order_open':
        if (cid === 'x1') hit.add('x1 post-only rests')
        if (cid === 'x3') hit.add('x3 GTD rests')
        if (cid === 'x4a' || cid === 'x4b') hit.add('x4 batch rests')
        if (cid === 'x5') hit.add('x5 remainder rests')
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
          if (cid === 'x1' && lastCancel === 'cancel_order') hit.add('cancel_order x1')
          if (lastCancel === 'cancel_batch') hit.add('cancel_batch cancels')
          if (lastCancel === 'cancel_market') hit.add('cancel_market cancels')
          if (lastCancel === 'cancel_all') hit.add('cancel_all cancels')
          if (isPeriodic(cid) && lastCancel === 'cancel_order') hit.add('periodic canceled')
        }
        break
      case 'order_rejected':
        if (cid === 'x7') hit.add('x7 post-only rejected')
        break
      case 'cancel_failed':
        if (r.op === 'cancel_batch') hit.add('cancel_batch cancel_failed')
        break
      case 'positions_split':
        hit.add('split')
        break
      case 'positions_merged':
        hit.add('merge')
        break
    }
  }
  return hit
}
