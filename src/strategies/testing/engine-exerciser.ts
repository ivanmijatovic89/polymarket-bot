import type {
  AccountEvent,
  Intent,
  MarketTick,
  OrderSide,
  PortfolioSnapshot,
  Strategy,
} from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import * as z from 'zod'

/**
 * Engine exerciser — parity-test strategy, NOT a trading strategy.
 *
 * Drives every engine feature (all intent kinds, FOK fill/kill, post-only
 * rejection, GTD expiry, crossing GTC remainder, cascading account intents,
 * cancel failures) on real markets so the TypeScript and Rust engines can be
 * diffed trace-by-trace. The contract is native/EXERCISER.md; the Rust twin
 * lives in native/strategies/engine-exerciser. Keep both byte-for-byte
 * equivalent in behavior — any change here must be mirrored there.
 *
 * Interpretation notes (where EXERCISER.md is silent):
 * - `n` counts real book/price_change ticks delivered to the strategy (in the
 *   backtest strategy window); synthetic feed ticks never count.
 * - A scheduled action whose bid/ask is missing stays pending and is retried on
 *   every following tick, in schedule order, until it fires. "skip" conditions
 *   (merge size 0, x8 size < 1, periodic slot with open orders) complete the
 *   action without an intent.
 * - Prices are snapped on the 1e-6 grid first (absorbs float noise), then down
 *   (BUY) / up (SELL) to the 0.01 tick, then clamped to [0.01, 0.99].
 * - Periodic slots: a new slot supersedes a still-pending older slot. The
 *   "no open orders" check reads the decision portfolio of that tick. The
 *   cancel fires at slot n + 40 (only if the slot's order was placed).
 */

export const ConfigSchema = z.strictObject({})

export type Config = z.infer<typeof ConfigSchema>

export const EXERCISER_ID = 'engine-exerciser'

export const definition: StrategyDefinition<Config> = {
  id: EXERCISER_ID,
  title: 'Engine exerciser (parity test)',
  description:
    'Deterministic parity-test strategy that drives every intent kind and execution edge case (native/EXERCISER.md). Not a trading strategy.',
  schema: ConfigSchema,
  create: () => ({ strategy: createExerciser() }),
}

const TICK_MICROS = 10_000 // 0.01 in 1e-6 units

/** Snap to the 0.01 tick (down for BUY, up for SELL) and clamp to [0.01, 0.99]. */
export function snapPrice(price: number, side: OrderSide): number {
  const micros = Math.round(price * 1_000_000)
  const ticks = side === 'BUY' ? Math.floor(micros / TICK_MICROS) : Math.ceil(micros / TICK_MICROS)
  return Math.min(99, Math.max(1, ticks)) / 100
}

type Book = { bid: number | null; ask: number | null }

type TickView = {
  n: number
  ts: number
  up: string
  down: string
  book: (asset: string) => Book
  portfolio: PortfolioSnapshot
}

/** Missing best price → retry on the next tick. */
const RETRY = Symbol('retry')
/** Condition not met → action completes without an intent. */
const SKIP = Symbol('skip')
type ActionResult = Intent[] | typeof RETRY | typeof SKIP

type ScheduledAction = { at: number; id: string; run: (v: TickView) => ActionResult }

function finite(x: number | null | undefined): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function pos(v: TickView, asset: string): number {
  return v.portfolio.positionsByAssetId[asset]?.qty ?? 0
}

function limit(
  cid: string,
  assetId: string,
  side: OrderSide,
  price: number,
  size: number,
  orderType: 'GTC' | 'GTD' | 'FOK',
  extra: { postOnly?: boolean; expireAtMs?: number } = {},
): Extract<Intent, { kind: 'place_limit' }> {
  return {
    kind: 'place_limit',
    clientOrderId: cid,
    assetId,
    side,
    price: snapPrice(price, side),
    size,
    orderType,
    ...(extra.postOnly !== undefined ? { postOnly: extra.postOnly } : {}),
    ...(extra.expireAtMs !== undefined ? { expireAtMs: extra.expireAtMs } : {}),
  }
}

const SCHEDULE: ScheduledAction[] = [
  {
    at: 50,
    id: 'x1',
    run: (v) => {
      const bid = v.book(v.up).bid
      if (bid === null) return RETRY
      return [limit('x1', v.up, 'BUY', bid, 10, 'GTC', { postOnly: true })]
    },
  },
  {
    at: 60,
    id: 'x2',
    run: (v) => {
      const ask = v.book(v.down).ask
      if (ask === null) return RETRY
      return [limit('x2', v.down, 'BUY', ask, 5, 'FOK')]
    },
  },
  {
    at: 70,
    id: 'split',
    run: (v) => [{ kind: 'split_positions', assetIdA: v.up, assetIdB: v.down, size: 10 }],
  },
  {
    at: 90,
    id: 'x3',
    run: (v) => {
      const bid = v.book(v.up).bid
      if (bid === null) return RETRY
      return [limit('x3', v.up, 'BUY', bid - 0.02, 6, 'GTD', { expireAtMs: v.ts + 120_000 })]
    },
  },
  {
    at: 100,
    id: 'x4',
    run: (v) => {
      const upAsk = v.book(v.up).ask
      const downAsk = v.book(v.down).ask
      if (upAsk === null || downAsk === null) return RETRY
      const a = limit('x4a', v.up, 'SELL', upAsk + 0.03, 4, 'GTC')
      const b = limit('x4b', v.down, 'SELL', downAsk + 0.03, 4, 'GTC')
      const strip = ({ kind: _kind, ...order }: typeof a) => {
        void _kind
        return order
      }
      return [{ kind: 'place_batch', orders: [strip(a), strip(b)] }]
    },
  },
  { at: 120, id: 'cancel-x1', run: () => [{ kind: 'cancel_order', clientOrderId: 'x1' }] },
  {
    at: 150,
    id: 'x5',
    run: (v) => {
      const ask = v.book(v.up).ask
      if (ask === null) return RETRY
      return [limit('x5', v.up, 'BUY', ask + 0.02, 200, 'GTC')]
    },
  },
  {
    at: 180,
    id: 'x6',
    run: (v) => {
      const bid = v.book(v.up).bid
      if (bid === null) return RETRY
      return [limit('x6', v.up, 'BUY', bid - 0.05, 5, 'FOK')]
    },
  },
  {
    at: 200,
    id: 'x7',
    run: (v) => {
      const ask = v.book(v.down).ask
      if (ask === null) return RETRY
      return [limit('x7', v.down, 'BUY', ask, 3, 'GTC', { postOnly: true })]
    },
  },
  {
    at: 220,
    id: 'cancel-batch',
    run: () => [
      {
        kind: 'cancel_batch',
        orders: [
          { clientOrderId: 'x4a' },
          { clientOrderId: 'x4b' },
          { clientOrderId: 'x9-missing' },
        ],
      },
    ],
  },
  {
    at: 260,
    id: 'merge',
    run: (v) => {
      const size = Math.min(pos(v, v.up), pos(v, v.down), 5)
      if (!(size > 0)) return SKIP
      return [{ kind: 'merge_positions', assetIdA: v.up, assetIdB: v.down, size }]
    },
  },
  { at: 300, id: 'cancel-market', run: (v) => [{ kind: 'cancel_market', assetId: v.up }] },
  {
    at: 400,
    id: 'x8',
    run: (v) => {
      const bid = v.book(v.up).bid
      if (bid === null) return RETRY
      const size = Math.min(pos(v, v.up), 5)
      if (size < 1) return SKIP
      return [limit('x8', v.up, 'SELL', bid, size, 'GTC')]
    },
  },
  { at: 500, id: 'cancel-all', run: () => [{ kind: 'cancel_all' }] },
]

const PERIODIC_FROM = 600
const PERIODIC_EVERY = 100
const PERIODIC_CANCEL_AFTER = 40

export function createExerciser(): Strategy {
  let n = -1
  const done = new Set<string>()
  let periodicPending: number | null = null
  const periodicCancelAt = new Map<number, number>() // slot -> tick n of its cancel
  let x2ExitPlaced = false

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const type = tick.msg.event_type
    if (type !== 'book' && type !== 'price_change') return []
    n += 1
    const up = ctx?.market?.upAssetId
    const down = ctx?.market?.downAssetId
    if (typeof up !== 'string' || typeof down !== 'string') return []

    const view: TickView = {
      n,
      ts: tick.snapshot.timestamp,
      up,
      down,
      portfolio,
      book: (asset) => {
        const b = tick.snapshot.byAssetId[asset]
        return { bid: finite(b?.bestBid), ask: finite(b?.bestAsk) }
      },
    }

    const out: Intent[] = []
    for (const action of SCHEDULE) {
      if (action.at > n || done.has(action.id)) continue
      const res = action.run(view)
      if (res === RETRY) continue
      done.add(action.id)
      if (res !== SKIP) out.push(...res)
    }

    for (const [slot, at] of periodicCancelAt) {
      if (at > n) continue
      periodicCancelAt.delete(slot)
      out.push({ kind: 'cancel_order', clientOrderId: `r${slot}` })
    }

    if (n >= PERIODIC_FROM && (n - PERIODIC_FROM) % PERIODIC_EVERY === 0) periodicPending = n
    if (periodicPending !== null) {
      const slot = periodicPending
      if (Object.keys(portfolio.openOrdersByClientId).length > 0) {
        periodicPending = null
      } else {
        const bid = view.book(up).bid
        if (bid !== null) {
          periodicPending = null
          out.push(limit(`r${slot}`, up, 'BUY', bid - 0.01, 5, 'GTC'))
          periodicCancelAt.set(slot, slot + PERIODIC_CANCEL_AFTER)
        }
      }
    }
    return out
  }

  const onAccountEvent = (ev: AccountEvent): Intent[] => {
    if (ev.kind !== 'fill' || x2ExitPlaced || ev.fill.clientOrderId !== 'x2') return []
    x2ExitPlaced = true
    return [limit('x2-exit', ev.fill.assetId, 'SELL', ev.fill.price + 0.05, ev.fill.size, 'GTC')]
  }

  return { name: EXERCISER_ID, onMarketTick, onAccountEvent }
}
