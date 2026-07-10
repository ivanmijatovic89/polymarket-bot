/**
 * Diagnostic fixture (EXP-000-debug only, never evidence): logs one line of
 * PRE-SPECIFIED venue statistics per market for the drift monitor
 * (DECISIONS D17). Places no orders and reads no outcomes — safe on any
 * window, including holdout.
 *
 * Per-market stats (UP asset, sampled every `sampleSec` of exchange time,
 * from first tick until `flushAfterSec` into the episode):
 *   ticks        — total ticks seen
 *   secs / rate  — observed span and ticks/sec
 *   crossedFrac  — fraction of ticks where either book is self-crossed (E6)
 *   spreadMed    — median sampled top-of-book UP spread
 *   depthMed     — median sampled UP top-level depth (bid0.size + ask0.size)
 *
 * Aggregate with `fable-lab/tools/venue-drift.ts`.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'

export const ConfigSchema = z.strictObject({
  sampleSec: z.coerce.number().finite().positive().max(300).default(10),
  flushAfterSec: z.coerce.number().finite().positive().max(900).default(780),
})
export type Config = z.infer<typeof ConfigSchema>

type Stats = {
  slug: string
  epochSec: number
  ticks: number
  crossed: number
  firstTs: number
  lastTs: number
  lastSampleTs: number
  spreads: number[]
  depths: number[]
  logged: boolean
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const definition: StrategyDefinition<Config> = {
  id: 'fable-diag-venue',
  title: 'diag venue-drift stats',
  description: 'Logs per-market venue statistics (spread/depth/crossed/rate); places no orders.',
  schema: ConfigSchema,
  create: (cfg) => {
    let st: Stats | null = null

    const flush = (): void => {
      if (!st || st.logged) return
      st.logged = true
      const secs = (st.lastTs - st.firstTs) / 1000
      const spreadMed = median(st.spreads)
      const depthMed = median(st.depths)
      console.log(
        `[diag-venue] slug=${st.slug} epoch=${st.epochSec} ticks=${st.ticks} ` +
          `secs=${secs.toFixed(0)} rate=${secs > 0 ? (st.ticks / secs).toFixed(2) : 'n/a'} ` +
          `crossedFrac=${st.ticks ? (st.crossed / st.ticks).toFixed(4) : 'n/a'} ` +
          `nSamp=${st.spreads.length} ` +
          `spreadMed=${spreadMed != null ? spreadMed.toFixed(4) : 'n/a'} ` +
          `depthMed=${depthMed != null ? depthMed.toFixed(1) : 'n/a'}`,
      )
    }

    const onMarketTick = (
      tick: MarketTick,
      _portfolio: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      const meta = ctx?.market
      const slug = meta?.slug
      const upAssetId = meta?.upAssetId
      const downAssetId = meta?.downAssetId
      if (!slug || !upAssetId || !downAssetId) return []

      if (!st || st.slug !== slug) {
        flush()
        const epochMatch = slug.match(/-(\d+)$/)
        st = {
          slug,
          epochSec: epochMatch ? Number(epochMatch[1]) : 0,
          ticks: 0,
          crossed: 0,
          firstTs: tick.snapshot.timestamp,
          lastTs: tick.snapshot.timestamp,
          lastSampleTs: 0,
          spreads: [],
          depths: [],
          logged: false,
        }
      }

      const ts = tick.snapshot.timestamp
      st.ticks++
      st.lastTs = ts

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      if (up == null || down == null) return []

      const isCrossed = (b: typeof up): boolean =>
        b.bestBid != null && b.bestAsk != null && b.bestBid >= b.bestAsk
      if (isCrossed(up) || isCrossed(down)) st.crossed++

      const elapsedMs = st.epochSec > 0 ? ts - st.epochSec * 1000 : Number.NaN
      if (Number.isFinite(elapsedMs) && elapsedMs > cfg.flushAfterSec * 1000) {
        flush()
        return []
      }

      if (ts - st.lastSampleTs >= cfg.sampleSec * 1000 && !isCrossed(up)) {
        st.lastSampleTs = ts
        if (up.spread != null) st.spreads.push(up.spread)
        const bid0 = up.bids[0]?.size
        const ask0 = up.asks[0]?.size
        if (bid0 != null && ask0 != null) st.depths.push(bid0 + ask0)
      }
      return []
    }

    const strategy: Strategy = {
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
