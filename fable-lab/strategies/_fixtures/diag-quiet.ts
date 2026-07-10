/**
 * Diagnostic fixture (EXP-000-debug only, never evidence): measures how often
 * EXP-006's quiet-regime quoting gate would open, and which condition blocks
 * it. Logs one summary line per market to stdout; places no orders.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'

export const ConfigSchema = z.strictObject({
  quietWindowSec: z.coerce.number().finite().positive().max(600).default(60),
  minElapsedSec: z.coerce.number().finite().nonnegative().max(800).default(60),
  stopBeforeEndSec: z.coerce.number().finite().positive().max(800).default(120),
})
export type Config = z.infer<typeof ConfigSchema>

const EPISODE_MS = 900_000

type Stats = {
  slug: string
  ticks: number
  inWindow: number
  covered: number
  crossed: number
  quietAt: Record<string, number>
  minRange: number
  // At the 0.02 quiet threshold: per-side quote feasibility (EXP-006 logic).
  quoteOk: number
  blockedLow: number
  blockedHigh: number
  blockedAsk: number
  quietMidSum: number
  quietN: number
  logged: boolean
}

export const definition: StrategyDefinition<Config> = {
  id: 'fable-diag-quiet',
  title: 'diag quiet-gate stats',
  description: 'Logs EXP-006 gate-opening statistics per market; places no orders.',
  schema: ConfigSchema,
  create: (cfg) => {
    const THRESHOLDS = [0.005, 0.01, 0.02, 0.04, 0.08]
    let midBuf: Array<{ ts: number; mid: number }> = []
    let st: Stats | null = null

    const flush = (): void => {
      if (!st || st.logged) return
      st.logged = true
      const q = THRESHOLDS.map(
        (t) => `q${t}=${st!.inWindow ? (st!.quietAt[String(t)] / st!.inWindow).toFixed(3) : 'n/a'}`,
      ).join(' ')
      console.log(
        `[diag-quiet] ${st.slug} ticks=${st.ticks} inWindow=${st.inWindow} ` +
          `coveredFrac=${st.inWindow ? (st.covered / st.inWindow).toFixed(3) : 'n/a'} ` +
          `crossedFrac=${st.inWindow ? (st.crossed / st.inWindow).toFixed(3) : 'n/a'} ` +
          `minRange=${Number.isFinite(st.minRange) ? st.minRange.toFixed(4) : 'inf'} ${q} ` +
          `| quietTicks=${st.quietN} meanQuietMid=${st.quietN ? (st.quietMidSum / st.quietN).toFixed(3) : 'n/a'} ` +
          `sideChecks ok=${st.quoteOk} low=${st.blockedLow} high=${st.blockedHigh} askCross=${st.blockedAsk}`,
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
        midBuf = []
        st = {
          slug,
          ticks: 0,
          inWindow: 0,
          covered: 0,
          crossed: 0,
          quietAt: Object.fromEntries(THRESHOLDS.map((t) => [String(t), 0])),
          minRange: Number.POSITIVE_INFINITY,
          quoteOk: 0,
          blockedLow: 0,
          blockedHigh: 0,
          blockedAsk: 0,
          quietMidSum: 0,
          quietN: 0,
          logged: false,
        }
      }
      st.ticks++

      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const ts = tick.snapshot.timestamp
      const elapsedMs = ts - Number(epochMatch[1]) * 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upMid = up?.mid
      if (up == null || down == null || upMid == null) return []

      midBuf.push({ ts, mid: upMid })
      const cutoff = ts - cfg.quietWindowSec * 1000
      while (midBuf.length >= 2 && midBuf[1].ts <= cutoff) midBuf.shift()
      const covered = midBuf[0].ts <= cutoff

      const inWindow =
        elapsedMs >= cfg.minElapsedSec * 1000 &&
        elapsedMs <= EPISODE_MS - cfg.stopBeforeEndSec * 1000
      if (!inWindow) {
        // Past the quote window: emit the summary once.
        if (elapsedMs > EPISODE_MS - cfg.stopBeforeEndSec * 1000) flush()
        return []
      }
      st.inWindow++

      const isCrossed = (b: typeof up): boolean =>
        b.bestBid != null && b.bestAsk != null && b.bestBid >= b.bestAsk
      if (isCrossed(up) || isCrossed(down)) st.crossed++

      if (covered) {
        st.covered++
        let mn = Number.POSITIVE_INFINITY
        let mx = Number.NEGATIVE_INFINITY
        for (const s of midBuf) {
          if (s.mid < mn) mn = s.mid
          if (s.mid > mx) mx = s.mid
        }
        const range = mx - mn
        if (range < st.minRange) st.minRange = range
        for (const t of THRESHOLDS) if (range <= t) st.quietAt[String(t)]++
        // EXP-006 primary-cell side checks at the 0.02 quiet threshold.
        if (range <= 0.02) {
          st.quietN++
          st.quietMidSum += upMid
          for (const side of ['UP', 'DOWN'] as const) {
            const book = side === 'UP' ? up : down
            const fair = side === 'UP' ? upMid : 1 - upMid
            const price = Math.floor((fair - 0.02) * 100) / 100
            const ask = book.bestAsk
            if (price < 0.05) st.blockedLow++
            else if (price > 0.95) st.blockedHigh++
            else if (ask == null || price >= ask) st.blockedAsk++
            else st.quoteOk++
          }
        }
      }
      return []
    }

    const strategy: Strategy = {
      name: 'fable-diag-quiet',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
