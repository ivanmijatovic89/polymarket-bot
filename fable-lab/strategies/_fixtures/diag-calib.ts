/**
 * Diagnostic fixture for CAL-001 (knowledge/CALIBRATION.md, DECISIONS D21).
 * Outcome-free: places no orders, reads no PnL, logs no outcome. It logs one
 * line per (market, offset) the moment the first uncrossed UP top-of-book
 * at-or-after that episode-clock offset is observed. Immediate emission (no
 * end-of-market flush) because the engine gives strategies no episode-end
 * hook and a fresh instance per market — buffering would silently drop every
 * market whose recording ends before the last offset. Offsets are frozen in
 * CALIBRATION.md; the schema default is the registered set.
 *
 * Log shape (parsed by tools/calib.ts), one line per captured sample. `ts`
 * is the actual capture time (elapsed episode seconds) — logged so that
 * late captures (recording gaps, late starts) are measurable and filterable
 * post-hoc instead of silently mislabeling the time axis (CAL-001 audit
 * finding 1: without ts, one late tick could stamp every offset with
 * expiry-regime prices and the leak would be invisible):
 *   [diag-calib] slug=<slug> epoch=<sec> off=<sec> ts=<elapsedSec> bid=<px> ask=<px>
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'

export const ConfigSchema = z.strictObject({
  // Comma-separated seconds after window open. Default = the CAL-001 set.
  offsetsSec: z
    .string()
    .default('30,150,300,450,600,750,850')
    .transform((s) => s.split(',').map((x) => Number(x.trim())))
    .refine((xs) => xs.length > 0 && xs.every((x) => Number.isFinite(x) && x >= 0 && x < 900), {
      message: 'offsetsSec must be comma-separated numbers in [0, 900)',
    }),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-diag-calib',
  title: 'diag CAL-001 calibration samples',
  description: 'Logs first uncrossed UP top-of-book at fixed episode offsets; places no orders.',
  schema: ConfigSchema,
  create: (cfg) => {
    const offsets = cfg.offsetsSec
    // Per-market state; the engine creates a fresh strategy per market in
    // batch replay, but guard on slug anyway so a shared instance stays safe.
    let slugSeen = ''
    let epochSec = 0
    let captured: boolean[] = []

    const onMarketTick = (
      tick: MarketTick,
      _portfolio: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      const meta = ctx?.market
      const slug = meta?.slug
      const upAssetId = meta?.upAssetId
      if (!slug || !upAssetId) return []

      if (slug !== slugSeen) {
        slugSeen = slug
        const epochMatch = slug.match(/-(\d+)$/)
        epochSec = epochMatch ? Number(epochMatch[1]) : 0
        captured = offsets.map(() => false)
      }
      if (epochSec === 0) return []

      const ts = tick.snapshot.timestamp
      const elapsedSec = (ts - epochSec * 1000) / 1000
      if (elapsedSec >= 900) return [] // past the window: remaining offsets stay uncaptured

      const up = tick.snapshot.byAssetId[upAssetId]
      const bid = up?.bestBid
      const ask = up?.bestAsk
      if (bid == null || ask == null || bid >= ask) return [] // E6 crossed/incomplete guard

      for (let i = 0; i < offsets.length; i++) {
        if (captured[i] || elapsedSec < offsets[i]) continue
        captured[i] = true
        console.log(
          `[diag-calib] slug=${slug} epoch=${epochSec} off=${offsets[i]} ` +
            `ts=${elapsedSec.toFixed(1)} bid=${bid.toFixed(4)} ask=${ask.toFixed(4)}`,
        )
      }
      return []
    }

    const strategy: Strategy = {
      name: 'fable-diag-calib',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
