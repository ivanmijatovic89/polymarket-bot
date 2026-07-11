/**
 * SCR-B5 momentum template (`fable-scr-mom`, BATCH-005 FINAL RUN).
 *
 * One parameterized taker template covering ten BATCH-005 screens
 * (SCR-010..SCR-019): trailing-move trigger (continue or fade) with
 * optional gates (tight spread, L1 depth agreement, UTC hour band,
 * trailing realized-vol floor, pre-trigger quiet/dwell, collapse level
 * anchor) and optional exit structures (maker take-profit re-ask,
 * taker stop-loss) — the EXIT axis is the genuinely unswept dimension:
 * every prior taker cell held to settlement.
 *
 * Mechanism per cell is pinned in the BATCH-005 mini-specs. Trigger:
 * UP-mid move over the trailing windowSec reaches moveThresh; continue
 * buys the side the move favors, fade buys the other. With fromLevel
 * set (collapse cells), the trigger instead requires the mid to have
 * been at/above the level a window ago and to have fallen through
 * level − moveThresh now (mirror-symmetric for DOWN via 1 − level).
 *
 * Exits: 'settle' holds to resolution; 'tp' rests a GTC maker SELL at
 * entry + tpDelta (zero fee; fills when the bid punches through);
 * 'sl' taker-sells at the bid once it drops slDelta below entry.
 *
 * Replay-safe: deterministic; time only from tick.snapshot.timestamp;
 * E6 crossed-book guard; depth-clamped FOK entries; one entry/market.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Trailing move window (seconds). */
  windowSec: z.coerce.number().finite().positive().max(600).default(30),
  /** Absolute UP-mid move over the window that triggers entry. */
  moveThresh: z.coerce.number().finite().gt(0).lt(1).default(0.03),
  /** continue = buy the side the move favors; fade = the other side. */
  mode: z.enum(['continue', 'fade']).default('continue'),
  minElapsedSec: z.coerce.number().finite().nonnegative().max(880).default(60),
  maxElapsedSec: z.coerce.number().finite().positive().max(899).default(840),
  /** Exit structure. */
  exit: z.enum(['settle', 'tp', 'sl']).default('settle'),
  /** Maker take-profit distance above entry (exit=tp). */
  tpDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.02),
  /** Taker stop-loss distance below entry (exit=sl). */
  slDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.03),
  /** Gate: entry-side spread must be ≤ this (1 = off). */
  spreadMax: z.coerce.number().finite().gt(0).max(1).default(1),
  /** Gate: entry-side L1 bidSize/askSize ratio must be ≥ this (0 = off). */
  depthRatioMin: z.coerce.number().finite().nonnegative().default(0),
  /** Gate: UTC hour band [hourMin, hourMax) (0/24 = off). */
  hourMin: z.coerce.number().finite().nonnegative().max(24).default(0),
  hourMax: z.coerce.number().finite().positive().max(24).default(24),
  /** Gate: trailing mid RANGE (high−low) over volWindowSec must be ≥ volMin (0 = off). */
  volMin: z.coerce.number().finite().nonnegative().default(0),
  volWindowSec: z.coerce.number().finite().positive().max(600).default(120),
  /** Gate: mid RANGE in the preQuietWindowSec BEFORE the trigger window ≤ this (1 = off). */
  preQuietMax: z.coerce.number().finite().gt(0).max(1).default(1),
  preQuietWindowSec: z.coerce.number().finite().positive().max(600).default(120),
  /** Collapse anchor level (0 = off; requires mode=fade — buys the collapsed side). */
  fromLevel: z.coerce.number().finite().nonnegative().lt(1).default(0),
  /** Entry ask sanity bounds. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.03),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.97),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

type Sample = { ts: number; mid: number }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-mom',
  title: 'SCR-B5 momentum template (gates + exit structures)',
  description:
    'Trailing-move taker trigger (continue/fade) with optional spread/depth/hour/vol/dwell/collapse gates and settle/tp/sl exits.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let exited = false
    let entrySide: 'UP' | 'DOWN' | null = null
    let entryAssetId: string | null = null
    let entryPrice = 0
    let heldShares = 0
    const buf: Sample[] = []

    /** Latest sample at-or-before ts, or null when the buffer does not reach back. */
    const sampleAtOrBefore = (ts: number): Sample | null => {
      let found: Sample | null = null
      for (const s of buf) {
        if (s.ts <= ts) found = s
        else break
      }
      return found
    }

    const onMarketTick = (
      tick: MarketTick,
      _portfolio: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      if (!isWarmed(ctx)) return []
      const meta = ctx?.market
      const slug = meta?.slug
      const upAssetId = meta?.upAssetId
      const downAssetId = meta?.downAssetId
      if (!slug || !upAssetId || !downAssetId) return []
      if (stateSlug !== slug) {
        stateSlug = slug
        entered = false
        exited = false
        entrySide = null
        entryAssetId = null
        entryPrice = 0
        heldShares = 0
        buf.length = 0
      }

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const now = tick.snapshot.timestamp
      const elapsedMs = now - Number(epochMatch[1]) * 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (upBid == null || upAsk == null || upBid >= upAsk) return [] // E6 guard
      const upMid = (upBid + upAsk) / 2

      // Maintain the trailing mid buffer (pruned past the longest lookback).
      buf.push({ ts: now, mid: upMid })
      const keepMs = (cfg.windowSec + cfg.preQuietWindowSec + Math.max(cfg.volWindowSec, 0) + 30) * 1000
      while (buf.length > 1 && buf[0] != null && buf[0].ts < now - keepMs) buf.shift()

      // Stop-loss monitoring for an open position.
      if (entered && !exited && cfg.exit === 'sl' && entryAssetId != null) {
        const book = tick.snapshot.byAssetId[entryAssetId]
        const bid = book?.bestBid
        const ask = book?.bestAsk
        if (book != null && bid != null && ask != null && bid < ask && bid <= entryPrice - cfg.slDelta) {
          let depth = 0
          for (const lvl of book.bids) {
            if (lvl.price < bid) break
            depth += lvl.size
          }
          const size = Math.min(heldShares, depth)
          if (size > 0) {
            exited = true
            return [
              {
                kind: 'place_limit',
                clientOrderId: `scrmom:${slug}:sl`,
                assetId: entryAssetId,
                side: 'SELL',
                price: bid,
                size,
                orderType: 'FOK',
                meta: { exp: 'SCR-B5-mom', leg: 'stop', entryPrice, stopBid: bid },
                reason: 'stop-loss taker exit',
              },
            ]
          }
        }
        return []
      }
      if (entered) return []
      if (elapsedMs < cfg.minElapsedSec * 1000 || elapsedMs > cfg.maxElapsedSec * 1000) return []

      // UTC hour gate.
      if (cfg.hourMin > 0 || cfg.hourMax < 24) {
        const hour = new Date(now).getUTCHours()
        if (hour < cfg.hourMin || hour >= cfg.hourMax) return []
      }

      const past = sampleAtOrBefore(now - cfg.windowSec * 1000)
      if (past == null) return []
      const move = upMid - past.mid

      // Trigger + direction.
      let dir: 'UP' | 'DOWN' | null = null
      if (cfg.fromLevel > 0) {
        // Collapse anchor: a former favorite fell through level − moveThresh.
        if (past.mid >= cfg.fromLevel && upMid <= cfg.fromLevel - cfg.moveThresh) {
          dir = 'UP' // UP was the favorite that collapsed; fade buys it back
        } else if (past.mid <= 1 - cfg.fromLevel && upMid >= 1 - cfg.fromLevel + cfg.moveThresh) {
          dir = 'DOWN' // DOWN collapsed (upMid rose through the mirror level)
        }
        if (dir === null) return []
      } else {
        if (Math.abs(move) < cfg.moveThresh) return []
        const moveSide: 'UP' | 'DOWN' = move > 0 ? 'UP' : 'DOWN'
        dir = cfg.mode === 'continue' ? moveSide : moveSide === 'UP' ? 'DOWN' : 'UP'
      }

      // Dwell gate: mid RANGE in the window BEFORE the trigger window must
      // be small. Requires the buffer to actually reach back that far.
      if (cfg.preQuietMax < 1) {
        const preFrom = now - (cfg.windowSec + cfg.preQuietWindowSec) * 1000
        const preTo = now - cfg.windowSec * 1000
        if (sampleAtOrBefore(preFrom) == null) return []
        let lo = Infinity
        let hi = -Infinity
        for (const s of buf) {
          if (s.ts < preFrom || s.ts > preTo) continue
          if (s.mid < lo) lo = s.mid
          if (s.mid > hi) hi = s.mid
        }
        if (!(hi >= lo) || hi - lo > cfg.preQuietMax) return []
      }

      // Trailing-vol gate: mid RANGE (high−low) over volWindowSec.
      if (cfg.volMin > 0) {
        const cutoff = now - cfg.volWindowSec * 1000
        if (sampleAtOrBefore(cutoff) == null) return []
        let lo = Infinity
        let hi = -Infinity
        for (const s of buf) {
          if (s.ts < cutoff) continue
          if (s.mid < lo) lo = s.mid
          if (s.mid > hi) hi = s.mid
        }
        if (!(hi >= lo) || hi - lo < cfg.volMin) return []
      }

      const down = tick.snapshot.byAssetId[downAssetId]
      const book = dir === 'UP' ? up : down
      const assetId = dir === 'UP' ? upAssetId : downAssetId
      const ask = book?.bestAsk
      const bid = book?.bestBid
      if (book == null || ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) return []
      if (bid != null && bid >= ask) return [] // E6 guard
      if (cfg.spreadMax < 1 && (bid == null || ask - bid > cfg.spreadMax)) return []
      if (cfg.depthRatioMin > 0) {
        const bidL1 = book.bids[0]?.size ?? 0
        const askL1 = book.asks[0]?.size ?? 0
        if (askL1 <= 0 || bidL1 / askL1 < cfg.depthRatioMin) return []
      }

      let depth = 0
      for (const lvl of book.asks) {
        if (lvl.price > ask) break
        depth += lvl.size
      }
      const size = Math.min(cfg.shares, depth)
      if (size <= 0) return []

      entered = true
      entrySide = dir
      entryAssetId = assetId
      entryPrice = ask
      return [
        {
          kind: 'place_limit',
          clientOrderId: `scrmom:${slug}:entry`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: { exp: 'SCR-B5-mom', mode: cfg.mode, side: dir, move, entryAsk: ask },
          reason: 'momentum trigger entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-mom',
      onMarketTick,
      onAccountEvent: (ev) => {
        if (ev.kind !== 'fill') return []
        const fill = ev.fill
        if (!fill.clientOrderId?.startsWith(`scrmom:${stateSlug}:entry`)) return []
        heldShares += fill.size
        if (cfg.exit !== 'tp' || exited) return []
        const tpPrice = Math.min(Math.round((fill.price + cfg.tpDelta) * 100) / 100, 0.99)
        exited = true // one TP order per market; rests until filled or settlement
        return [
          {
            kind: 'place_limit',
            clientOrderId: `scrmom:${stateSlug}:tp`,
            assetId: fill.assetId,
            side: 'SELL',
            price: tpPrice,
            size: fill.size,
            orderType: 'GTC',
            meta: { exp: 'SCR-B5-mom', leg: 'tp', entryPrice: fill.price, tpPrice, side: entrySide },
            reason: 'maker take-profit re-ask',
          },
        ]
      },
    }
    return { strategy }
  },
}
