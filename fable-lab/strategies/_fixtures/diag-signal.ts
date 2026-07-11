/**
 * Diagnostic fixture for SIGNAL-001 (knowledge/SIGNAL-MAP.md — the
 * operator-mandated gross-signal map, 2026-07-11). Outcome-free: places no
 * orders, reads no PnL, logs no outcome. At each frozen episode offset it
 * emits ONE line per market with a causal feature vector computed from all
 * ticks observed so far (book shape, activity, path volatility) — the axes
 * the CAL-001 log cannot express (it recorded top-of-book prices only).
 *
 * Emission rule (diag-calib precedent): first tick at-or-after the offset
 * where the UP book is present and uncrossed (E6 guard). DOWN book is an
 * exact mirror of UP (CAL-001 amendment #12) so only UP-book depth is
 * emitted; DOWN top-of-book quotes are still logged for the scan's
 * DOWN-side entry pricing. `ts` is actual capture time (elapsed episode
 * seconds) so late captures are filterable post-hoc.
 *
 * Feature state updates stop after the last offset is emitted (or 900s),
 * to bound per-tick cost on 100k-event markets.
 *
 * Log shape (parsed by tools/signal-scan.ts), one line per (market, offset):
 *   [diag-signal] slug=<slug> epoch=<sec> off=<sec> ts=<elapsed> \
 *     upBid= upAsk= dnBid= dnAsk= l1Imb= l5Imb= l10Imb= dTot5= dTot10= \
 *     nTicks= rate60= vol= nz= flips= range= posR= move60= firstMid= \
 *     firstTs= crossedN=
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'

export const ConfigSchema = z.strictObject({
  // Comma-separated seconds after window open. Default = the SIGNAL-001 set.
  offsetsSec: z
    .string()
    .default('150,300,600,750,850')
    .transform((s) => s.split(',').map((x) => Number(x.trim())))
    .refine((xs) => xs.length > 0 && xs.every((x) => Number.isFinite(x) && x >= 0 && x < 900), {
      message: 'offsetsSec must be comma-separated numbers in [0, 900)',
    }),
})
export type Config = z.infer<typeof ConfigSchema>

const f = (x: number): string => x.toFixed(4)

export const definition: StrategyDefinition<Config> = {
  id: 'fable-diag-signal',
  title: 'diag SIGNAL-001 feature samples',
  description:
    'Logs causal book-shape/activity/path features at fixed episode offsets; places no orders.',
  schema: ConfigSchema,
  create: (cfg) => {
    const offsets = cfg.offsetsSec
    const lastOffset = Math.max(...offsets)

    // Per-market state; engine creates a fresh instance per market in batch
    // replay, but guard on slug anyway (diag-calib precedent).
    let slugSeen = ''
    let epochSec = 0
    let emitted: boolean[] = []
    let emittedCount = 0
    // Path state (UP mid over uncrossed observations)
    let firstMid = NaN
    let firstTs = NaN
    let prevMid = NaN
    let minMid = NaN
    let maxMid = NaN
    let flips = 0
    let lastSign = 0
    let nz = 0
    // Welford over NONZERO consecutive-mid deltas
    let wCount = 0
    let wMean = 0
    let wM2 = 0
    // Activity
    let nTicks = 0
    let crossedN = 0
    // Ring of (elapsedSec, mid) for rate60/move60; entries older than 60s
    // are dropped from the head lazily.
    const ring: { t: number; mid: number }[] = []
    let ringHead = 0

    const reset = (slug: string): void => {
      slugSeen = slug
      const m = slug.match(/-(\d+)$/)
      epochSec = m ? Number(m[1]) : 0
      emitted = offsets.map(() => false)
      emittedCount = 0
      firstMid = NaN
      firstTs = NaN
      prevMid = NaN
      minMid = NaN
      maxMid = NaN
      flips = 0
      lastSign = 0
      nz = 0
      wCount = 0
      wMean = 0
      wM2 = 0
      nTicks = 0
      crossedN = 0
      ring.length = 0
      ringHead = 0
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
      if (slug !== slugSeen) reset(slug)
      if (epochSec === 0) return []
      if (emittedCount >= offsets.length) return [] // all offsets done: stop all work

      const ts = tick.snapshot.timestamp
      const elapsedSec = (ts - epochSec * 1000) / 1000
      if (elapsedSec >= 900) return []

      const up = tick.snapshot.byAssetId[upAssetId]
      const dn = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk

      nTicks++
      const valid = upBid != null && upAsk != null && upBid < upAsk
      if (upBid != null && upAsk != null && upBid >= upAsk) crossedN++

      if (valid) {
        const mid = (upBid + upAsk) / 2
        if (Number.isNaN(firstMid)) {
          firstMid = mid
          firstTs = elapsedSec
          minMid = mid
          maxMid = mid
        } else {
          const d = mid - prevMid
          if (d !== 0) {
            nz++
            wCount++
            const delta = d - wMean
            wMean += delta / wCount
            wM2 += delta * (d - wMean)
            const sign = d > 0 ? 1 : -1
            if (lastSign !== 0 && sign !== lastSign) flips++
            lastSign = sign
          }
          if (mid < minMid) minMid = mid
          if (mid > maxMid) maxMid = mid
        }
        prevMid = mid
        ring.push({ t: elapsedSec, mid })
        while (ringHead < ring.length && ring[ringHead].t < elapsedSec - 60) ringHead++

        // Emission: all not-yet-emitted offsets whose time has come.
        const dnBid = dn?.bestBid
        const dnAsk = dn?.bestAsk
        for (let i = 0; i < offsets.length; i++) {
          if (emitted[i] || elapsedSec < offsets[i]) continue
          emitted[i] = true
          emittedCount++
          const bd = up.bidsDepthByLevel
          const ad = up.asksDepthByLevel
          const lvl = (arr: number[], k: number): number =>
            arr.length === 0 ? 0 : arr[Math.min(k, arr.length - 1)]
          const b1 = lvl(bd, 0)
          const a1 = lvl(ad, 0)
          const b5 = lvl(bd, 4)
          const a5 = lvl(ad, 4)
          const b10 = lvl(bd, 9)
          const a10 = lvl(ad, 9)
          const imb = (b: number, a: number): number => (b + a > 0 ? b / (b + a) : 0.5)
          const rate60 = ring.length - ringHead
          const oldIdx = ringHead // oldest retained sample is ≥ elapsed-60s
          const move60 = ring.length > 0 ? mid - ring[oldIdx].mid : 0
          const vol = wCount > 1 ? Math.sqrt(wM2 / (wCount - 1)) : 0
          const range = maxMid - minMid
          const posR = range > 0 ? (mid - minMid) / range : 0.5
          console.log(
            `[diag-signal] slug=${slug} epoch=${epochSec} off=${offsets[i]} ts=${elapsedSec.toFixed(1)} ` +
              `upBid=${f(upBid)} upAsk=${f(upAsk)} dnBid=${f(dnBid ?? -1)} dnAsk=${f(dnAsk ?? -1)} ` +
              `l1Imb=${f(imb(b1, a1))} l5Imb=${f(imb(b5, a5))} l10Imb=${f(imb(b10, a10))} ` +
              `dTot5=${(b5 + a5).toFixed(1)} dTot10=${(b10 + a10).toFixed(1)} ` +
              `nTicks=${nTicks} rate60=${rate60} vol=${vol.toFixed(5)} nz=${nz} flips=${flips} ` +
              `range=${f(range)} posR=${f(posR)} move60=${f(move60)} ` +
              `firstMid=${f(firstMid)} firstTs=${firstTs.toFixed(1)} crossedN=${crossedN}`,
          )
          if (offsets[i] === lastOffset) return [] // nothing left to maintain
        }
      }
      return []
    }

    const strategy: Strategy = {
      name: 'fable-diag-signal',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
