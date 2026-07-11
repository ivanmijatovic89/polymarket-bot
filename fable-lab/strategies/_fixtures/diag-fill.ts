/**
 * Diagnostic fixture for SIGNAL-003 (knowledge/SIGNAL-FILLS.md — the
 * per-fill toxicity scan, IDEAS #22). Replays the EXACT run-472 SCR-008
 * cell (ungated DOWN-side at-touch bid, defaults frozen in BATCH-003) and
 * logs one `[diag-fill]` line per own fill: the fill facts plus the causal
 * book/path state at the LAST STRATEGY-SEEN TICK before the fill.
 *
 * Causality (verified against StrategyRunner.onMarketTick, session 64):
 * the runner drains execution fill events BEFORE the strategy sees the
 * fill-triggering tick, so the state logged here is what a live gate
 * could have acted on (modulo cancel latency — runs are pinned 0/0 per
 * D8/D51; the optimism is disclosed in the registration).
 *
 * Outcome-free: no PnL is read or logged; tools/signal3-scan.ts joins
 * telonex_markets.result_id ONCE after all shards complete (CAL
 * discipline). Local touch-mode runs only; D18 labeling rules bind
 * (batchUid must contain "touch").
 *
 * Log shape (parsed by tools/signal3-scan.ts), one line per fill:
 *   [diag-fill] slug= epoch= fillSeq= fTs= fPrice= fSize= fLiq= \
 *     stateTs= qAgeSec= qMidDrift= upBid= upAsk= dnBid= dnAsk= \
 *     l1Imb= l5Imb= l10Imb= dTot5= dTot10= nTicks= rate60= vol= nz= \
 *     flips= range= posR= move60= move10= firstMid= firstTs= crossedN=
 */
import * as z from 'zod'
import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

// Frozen run-472 cell (SCR-008 schema defaults; BATCH-003). Not configurable:
// the instrument's whole point is the fill population of THAT cell.
const START_SEC = 30
const END_SEC = 870
const REQUOTE_DELTA = 0.01
const MIN_PRICE = 0.02
const MAX_PRICE = 0.98
const MAX_INVENTORY = 100
const SHARES = 100

export const ConfigSchema = z.strictObject({})
export type Config = z.infer<typeof ConfigSchema>

type Quote = { clientOrderId: string; price: number; placedElapsed: number; midAtQuote: number }

const f = (x: number): string => x.toFixed(4)

export const definition: StrategyDefinition<Config> = {
  id: 'fable-diag-fill',
  title: 'diag SIGNAL-003 per-fill state samples (run-472 cell)',
  description:
    'Replays the ungated SCR-008 DOWN at-touch cell and logs causal pre-fill state per fill; outcome-free.',
  schema: ConfigSchema,
  create: () => {
    let stateSlug: string | null = null
    let epochSec = 0
    let seq = 0
    let fillSeq = 0
    let quote: Quote | null = null

    // Path/feature state over the UP book (diag-signal conventions;
    // DOWN book is an exact mirror, CAL-001 amendment #12).
    let firstMid = NaN
    let firstTs = NaN
    let prevMid = NaN
    let minMid = NaN
    let maxMid = NaN
    let flips = 0
    let lastSign = 0
    let nz = 0
    let wCount = 0
    let wMean = 0
    let wM2 = 0
    let nTicks = 0
    let crossedN = 0
    const ring: { t: number; mid: number }[] = []
    let ringHead = 0
    // Snapshot of the last strategy-seen tick (the causal pre-fill block).
    let lastState: string | null = null
    let lastStateTs = NaN

    const reset = (slug: string): void => {
      stateSlug = slug
      const m = slug.match(/-(\d+)$/)
      epochSec = m ? Number(m[1]) : 0
      seq = 0
      fillSeq = 0
      quote = null
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
      lastState = null
      lastStateTs = NaN
    }

    const onMarketTick = (
      tick: MarketTick,
      portfolio: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      if (!isWarmed(ctx)) return []
      const meta = ctx?.market
      const slug = meta?.slug
      const upAssetId = meta?.upAssetId
      const downAssetId = meta?.downAssetId
      if (!slug || !upAssetId || !downAssetId) return []
      if (stateSlug !== slug) reset(slug)
      if (epochSec === 0) return []
      const elapsedSec = (tick.snapshot.timestamp - epochSec * 1000) / 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      const dnBid = down?.bestBid
      const dnAsk = down?.bestAsk

      // ---- feature state update (every tick, diag-signal conventions) ----
      nTicks++
      const upValid = upBid != null && upAsk != null && upBid < upAsk
      if (upBid != null && upAsk != null && upBid >= upAsk) crossedN++
      if (upValid && elapsedSec < 900) {
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

        if (dnBid != null && dnAsk != null) {
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
          const move60 = ring.length > 0 ? mid - ring[ringHead].mid : 0
          let i10 = ring.length - 1
          while (i10 > ringHead && ring[i10 - 1].t >= elapsedSec - 10) i10--
          const move10 = ring.length > 0 ? mid - ring[i10].mid : 0
          const vol = wCount > 1 ? Math.sqrt(wM2 / (wCount - 1)) : 0
          const range = maxMid - minMid
          const posR = range > 0 ? (mid - minMid) / range : 0.5
          lastStateTs = elapsedSec
          lastState =
            `upBid=${f(upBid)} upAsk=${f(upAsk)} dnBid=${f(dnBid)} dnAsk=${f(dnAsk)} ` +
            `l1Imb=${f(imb(b1, a1))} l5Imb=${f(imb(b5, a5))} l10Imb=${f(imb(b10, a10))} ` +
            `dTot5=${(b5 + a5).toFixed(1)} dTot10=${(b10 + a10).toFixed(1)} ` +
            `nTicks=${nTicks} rate60=${rate60} vol=${vol.toFixed(5)} nz=${nz} flips=${flips} ` +
            `range=${f(range)} posR=${f(posR)} move60=${f(move60)} move10=${f(move10)} ` +
            `firstMid=${f(firstMid)} firstTs=${firstTs.toFixed(1)} crossedN=${crossedN}`
        }
      }

      // ---- SCR-008 quoting logic (verbatim semantics) ----
      const intents: Intent[] = []
      const cancelQuote = (reason: string): void => {
        if (!quote) return
        intents.push({ kind: 'cancel_order', clientOrderId: quote.clientOrderId, reason })
        quote = null
      }
      const upCrossed = upBid != null && upAsk != null && upBid >= upAsk
      if (down == null || dnBid == null || dnAsk == null || dnBid >= dnAsk || upCrossed) {
        cancelQuote('book unavailable/crossed')
        return intents
      }
      if (elapsedSec < START_SEC || elapsedSec > END_SEC) {
        cancelQuote('outside window')
        return intents
      }
      const inv = portfolio.positionsByAssetId[downAssetId]?.qty ?? 0
      if (inv >= MAX_INVENTORY) {
        cancelQuote('inventory cap')
        return intents
      }
      const price = dnBid // join the touch
      if (price >= dnAsk || price < MIN_PRICE || price > MAX_PRICE) {
        cancelQuote('no valid quote price')
        return intents
      }
      if (quote && Math.abs(quote.price - price) < REQUOTE_DELTA) return intents
      if (quote) cancelQuote('requote')
      const clientOrderId = `dfill:${slug}:${seq++}`
      const midNow = upValid ? (upBid + upAsk) / 2 : prevMid
      quote = { clientOrderId, price, placedElapsed: elapsedSec, midAtQuote: midNow }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId: downAssetId,
        side: 'BUY',
        price,
        size: SHARES,
        orderType: 'GTC',
        meta: { exp: 'SIGNAL-003', price, elapsedSec: Math.floor(elapsedSec) },
        reason: 'ungated DOWN at-touch bid (diag)',
      })
      return intents
    }

    const onAccountEvent = (ev: AccountEvent): Intent[] => {
      if (ev.kind !== 'fill') return []
      const fill = ev.fill
      if (!stateSlug || epochSec === 0) return []
      const fTs = (fill.tsMs - epochSec * 1000) / 1000
      // Quote-derived causal features. The fill may belong to a quote we
      // already replaced locally (requote race); attribute to the tracked
      // quote when ids match, else emit -1 sentinels.
      const own = quote && fill.clientOrderId === quote.clientOrderId ? quote : null
      const qAgeSec = own ? fTs - own.placedElapsed : -1
      const qMidDrift =
        own && !Number.isNaN(prevMid) && own.midAtQuote > 0 ? prevMid - own.midAtQuote : 0
      if (lastState === null) return []
      console.log(
        `[diag-fill] slug=${stateSlug} epoch=${epochSec} fillSeq=${fillSeq++} ` +
          `fTs=${fTs.toFixed(1)} fPrice=${f(fill.price)} fSize=${fill.size} ` +
          `fLiq=${fill.liquidity ?? 'UNK'} stateTs=${lastStateTs.toFixed(1)} ` +
          `qAgeSec=${qAgeSec.toFixed(1)} qMidDrift=${f(qMidDrift)} ${lastState}`,
      )
      return []
    }

    const strategy: Strategy = {
      name: 'fable-diag-fill',
      onMarketTick,
      onAccountEvent,
    }
    return { strategy }
  },
}
