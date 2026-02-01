import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'
import type { Plugin } from './PluginSet.js'
import { parseUpDown15mSlugEpochMs } from '../../polymarket/upDown15mWindowGuard.js'
import { fetchBinanceKlines, type BinanceCandle } from '../../trading/feeds/binanceKlines.js'
import { ATR, ADX, BollingerBands, SD } from 'technicalindicators'

type Session = 'ASIA' | 'EU' | 'US'

export type TechnicalIndicatorsSnapshot = {
  asOfTimeMs: number
  symbol: string
  tf1h: {
    atr14Pct: number | null
    bbWidth: number | null
    adx14: number | null
    hlRangePct: number | null
    wickRatio: number | null
    rv20: number | null
    rv80: number | null
    rv20Over80: number | null
  }
  tf15m: {
    hlRangePct: number | null
    wickRatio: number | null
    atr14Pct: number | null
    rv20: number | null
  }
  meta: {
    session: Session
    hourOfDayUTC: number
    dayOfWeekUTC: number
  }
  alignmentWarning?: string
}

const BINANCE_SYMBOL = 'BTCUSDT'
const SLUG_SYMBOL = 'btc'
const PERIOD_1H = {
  bb: 20,
  atr: 14,
  adx: 14,
  rvFast: 20,
  rvSlow: 80,
}

const PERIOD_15M = {
  atr: 14,
  rv: 20,
}

const MAX_PERIOD_1H = Math.max(PERIOD_1H.bb, PERIOD_1H.atr, PERIOD_1H.adx, PERIOD_1H.rvFast, PERIOD_1H.rvSlow)
const MAX_PERIOD_15M = Math.max(PERIOD_15M.atr, PERIOD_15M.rv)

const LOOKBACK_MULT = 2
const LOOKBACK_1H = MAX_PERIOD_1H * LOOKBACK_MULT
const LOOKBACK_15M = MAX_PERIOD_15M * LOOKBACK_MULT

const FETCH_BUFFER = 10
const LIMIT_1H = LOOKBACK_1H + FETCH_BUFFER
const LIMIT_15M = LOOKBACK_15M + FETCH_BUFFER
const EPS = 1e-12

function sessionFromHourUTC(h: number): Session {
  if (h >= 0 && h <= 7) return 'ASIA'
  if (h >= 8 && h <= 15) return 'EU'
  return 'US'
}

function last<T>(arr: T[]): T | undefined {
  return arr.length > 0 ? arr[arr.length - 1] : undefined
}

function realizedVolFromCloses(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null
  const returns: number[] = []
  for (let i = 1; i < closes.length; i += 1) {
    const a = closes[i - 1]
    const b = closes[i]
    if (a == null || b == null) return null
    if (!(a > 0 && b > 0)) return null
    returns.push(Math.log(b / a))
  }
  if (returns.length < period) return null
  const rvArr = SD.calculate({ period, values: returns })
  const rvLast = last(rvArr)
  return typeof rvLast === 'number' && Number.isFinite(rvLast) ? rvLast : null
}

function computeIndicators1h(candles: BinanceCandle[]) {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)

  const atrArr = ATR.calculate({ period: PERIOD_1H.atr, high: highs, low: lows, close: closes })
  const adxArr = ADX.calculate({ period: PERIOD_1H.adx, high: highs, low: lows, close: closes })
  const bbArr = BollingerBands.calculate({ period: PERIOD_1H.bb, stdDev: 2, values: closes })

  const lastClose = last(closes)
  const atr14 = last(atrArr) ?? null
  const adx14 = last(adxArr)?.adx ?? null
  const bbLast = last(bbArr)

  const atr14Pct =
    atr14 != null && lastClose != null && Number.isFinite(lastClose) && lastClose > 0 ? atr14 / lastClose : null
  const bbWidth =
    bbLast && bbLast.middle
      ? (bbLast.upper - bbLast.lower) / bbLast.middle
      : null
  const lastCandle = last(candles)
  const hlRangePct =
    lastCandle && lastCandle.low > 0 ? (lastCandle.high - lastCandle.low) / lastCandle.low : null

  let wickRatio: number | null = null
  if (lastCandle) {
    const body = Math.abs(lastCandle.close - lastCandle.open)
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close)
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low
    wickRatio = (upperWick + lowerWick) / Math.max(body, EPS)
  }

  const rv20 = realizedVolFromCloses(closes, PERIOD_1H.rvFast)
  const rv80 = realizedVolFromCloses(closes, PERIOD_1H.rvSlow)
  const rv20Over80 = rv20 != null && rv80 != null && rv80 !== 0 ? rv20 / rv80 : null

  return { atr14Pct, bbWidth, adx14, hlRangePct, wickRatio, rv20, rv80, rv20Over80 }
}

function computeIndicators15m(candles: BinanceCandle[]) {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)

  const atrArr = ATR.calculate({ period: PERIOD_15M.atr, high: highs, low: lows, close: closes })
  const lastClose = last(closes)
  const atr14 = last(atrArr) ?? null
  const atr14Pct =
    atr14 != null && lastClose != null && Number.isFinite(lastClose) && lastClose > 0 ? atr14 / lastClose : null

  const rv20 = realizedVolFromCloses(closes, PERIOD_15M.rv)

  const lastCandle = last(candles)
  if (!lastCandle) {
    return { hlRangePct: null, wickRatio: null, atr14Pct, rv20 }
  }

  const hlRangePct = lastCandle.low > 0 ? (lastCandle.high - lastCandle.low) / lastCandle.low : null

  const body = Math.abs(lastCandle.close - lastCandle.open)
  const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close)
  const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low
  const wickRatio = (upperWick + lowerWick) / Math.max(body, EPS)

  return { hlRangePct, wickRatio, atr14Pct, rv20 }
}

export class TechnicalIndicatorsPlugin implements Plugin {
  readonly id = 'technicalIndicators'

  private cached: TechnicalIndicatorsSnapshot | undefined
  private lastMarketKey: string | null = null
  private lastComputedKey: string | null = null
  private inFlightKey: string | null = null

  reset(): void {
    this.cached = undefined
    this.lastMarketKey = null
    this.lastComputedKey = null
    this.inFlightKey = null
  }

  onMarketTick(tick: MarketTick, ctx?: StrategyContext): void {
    const slug = typeof ctx?.market?.slug === 'string' ? ctx.market.slug : null
    const marketId = typeof tick.snapshot.market === 'string' ? tick.snapshot.market : null
    const marketKey = slug ?? marketId
    if (!marketKey) return

    if (this.lastMarketKey !== marketKey) {
      this.lastMarketKey = marketKey
      this.lastComputedKey = null
      this.inFlightKey = null
      this.cached = undefined
    }

    if (this.lastComputedKey === marketKey) return
    if (this.inFlightKey === marketKey) return
    if (!slug) return

    this.inFlightKey = marketKey
    void this.computeSnapshot({ marketKey, marketId, slug }).finally(() => {
      if (this.inFlightKey === marketKey) this.inFlightKey = null
    })
  }

  snapshot(): TechnicalIndicatorsSnapshot | undefined {
    return this.cached
  }

  private finalizeSnapshot(args: { marketKey: string; snapshot: TechnicalIndicatorsSnapshot | undefined }): void {
    if (this.lastMarketKey !== args.marketKey) return
    this.cached = args.snapshot
    this.lastComputedKey = args.marketKey
  }

  private async computeSnapshot(args: {
    marketKey: string
    marketId: string | null
    slug: string
  }): Promise<void> {
    const t0Ms = parseUpDown15mSlugEpochMs({ slug: args.slug, symbol: SLUG_SYMBOL })
    if (t0Ms === null) {
      console.warn(`[technicalIndicators] unsupported slug, skipping: ${args.slug}`)
      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
      return
    }

    const asOfMs = t0Ms - 1
    if (!Number.isFinite(asOfMs) || asOfMs <= 0) {
      console.warn(`[technicalIndicators] invalid asOfMs=${asOfMs} slug=${args.slug}`)
      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
      return
    }

    try {
      const [raw1h, raw15m] = await Promise.all([
        fetchBinanceKlines({ symbol: BINANCE_SYMBOL, interval: '1h', endTimeMs: asOfMs, limit: LIMIT_1H }),
        fetchBinanceKlines({ symbol: BINANCE_SYMBOL, interval: '15m', endTimeMs: asOfMs, limit: LIMIT_15M }),
      ])

      const candles1hAll = raw1h.filter((c) => c.closeTime <= asOfMs)
      const candles15mAll = raw15m.filter((c) => c.closeTime <= asOfMs)

      if (candles1hAll.length < LOOKBACK_1H) {
        console.warn(
          `[technicalIndicators] not enough 1h candles: have=${candles1hAll.length} need=${LOOKBACK_1H} slug=${args.slug}`,
        )
        this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
        return
      }
      if (candles15mAll.length < LOOKBACK_15M) {
        console.warn(
          `[technicalIndicators] not enough 15m candles: have=${candles15mAll.length} need=${LOOKBACK_15M} slug=${args.slug}`,
        )
        this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
        return
      }

      const candles1h = candles1hAll.slice(-LOOKBACK_1H)
      const candles15m = candles15mAll.slice(-LOOKBACK_15M)

      const last15m = last(candles15m)
      const expected15mClose = t0Ms - 1
      if (!last15m || last15m.closeTime !== expected15mClose) {
        console.warn(
          `[technicalIndicators] 15m misalignment: lastClose=${last15m?.closeTime ?? 'n/a'} expected=${expected15mClose} slug=${args.slug}`,
        )
        this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
        return
      }

      const tf1h = computeIndicators1h(candles1h)
      const tf15m = computeIndicators15m(candles15m)

      const d = new Date(t0Ms)
      const hourOfDayUTC = d.getUTCHours()
      const dayOfWeekUTC = d.getUTCDay()

      const snapshot: TechnicalIndicatorsSnapshot = {
        asOfTimeMs: t0Ms,
        symbol: BINANCE_SYMBOL,
        tf1h,
        tf15m,
        meta: {
          session: sessionFromHourUTC(hourOfDayUTC),
          hourOfDayUTC,
          dayOfWeekUTC,
        },
      }

      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot })

      const marketLabel = args.slug ?? args.marketId ?? args.marketKey
      const fmt = (v: number | null): string => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6) : 'null')
      const warn = ''
      console.log(
        `[technicalIndicators] market=${marketLabel} tf1h.wickRatio=${fmt(tf1h.wickRatio)} tf15m.wickRatio=${fmt(tf15m.wickRatio)} tf15m.hlRangePct=${fmt(tf15m.hlRangePct)} tf1h.adx14=${fmt(tf1h.adx14)}${warn}`,
      )
    } catch (err) {
      console.error(`[technicalIndicators] failed to compute snapshot for slug=${args.slug}`, err)
      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
    }
  }
}
