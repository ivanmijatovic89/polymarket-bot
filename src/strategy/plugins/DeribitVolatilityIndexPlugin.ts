import type { MarketTick } from '../Strategy.js'
import type { StrategyContext } from '../StrategyContext.js'
import type { Plugin } from './PluginSet.js'
import { parseUpDown15mSlugEpochMs } from '../../polymarket/upDown15mWindowGuard.js'
import {
  fetchDeribitVolatilityIndexData,
  type DeribitVolatilityCandle,
} from '../../trading/feeds/deribitVolatilityIndex.js'

type DvolCandle = {
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
}

// Remove any resolution from this list to disable it.
const RESOLUTIONS_SEC = [
  300, // 5m (primary)
  900, // 15m
  3600, // 1h (secondary)
] as const

type ResolutionSec = (typeof RESOLUTIONS_SEC)[number]

export type DeribitVolatilityIndexSnapshot = {
  asOfTimeMs: number
  currency: 'BTC'
  byResolutionSec: Record<ResolutionSec, DvolCandle | null>
  alignmentWarning?: string
}

const DERIBIT_BASE_URL = 'https://www.deribit.com'
const SLUG_SYMBOL = 'btc'
const BASE_RESOLUTION_SEC = 60
const BASE_RESOLUTION_MS = BASE_RESOLUTION_SEC * 1000
const BASE_RESOLUTION_STR = '60' as const

function expectedCloseTimeMs(asOfMs: number, resMs: number): number {
  return Math.floor((asOfMs + 1) / resMs) * resMs - 1
}

function mapToBaseCandles(rows: DeribitVolatilityCandle[]): DvolCandle[] {
  const out: DvolCandle[] = []
  for (const r of rows) {
    const openTime = Math.trunc(r.timestamp)
    const closeTime = openTime + BASE_RESOLUTION_MS - 1
    out.push({
      openTime,
      closeTime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    })
  }
  return out.sort((a, b) => a.openTime - b.openTime)
}

function aggregateCandle(
  candles60: DvolCandle[],
  resSec: number,
  asOfMs: number,
): DvolCandle | null {
  const resMs = resSec * 1000
  const expectedClose = expectedCloseTimeMs(asOfMs, resMs)
  const expectedOpen = expectedClose - resMs + 1

  const bucket = candles60.filter((c) => c.openTime >= expectedOpen && c.closeTime <= expectedClose)
  if (bucket.length === 0) return null

  const expectedCount = Math.round(resMs / BASE_RESOLUTION_MS)
  if (bucket.length < expectedCount) return null

  bucket.sort((a, b) => a.openTime - b.openTime)
  const open = bucket[0]!.open
  const close = bucket[bucket.length - 1]!.close
  const openTime = bucket[0]!.openTime
  const closeTime = bucket[bucket.length - 1]!.closeTime
  let high = bucket[0]!.high
  let low = bucket[0]!.low
  for (const c of bucket) {
    if (c.high > high) high = c.high
    if (c.low < low) low = c.low
  }

  return {
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
  }
}

export class DeribitVolatilityIndexPlugin implements Plugin {
  readonly id = 'deribitVolatilityIndex'

  private readonly baseUrl: string
  private cached: DeribitVolatilityIndexSnapshot | undefined
  private lastMarketKey: string | null = null
  private lastComputedKey: string | null = null
  private inFlightKey: string | null = null

  constructor(cfg?: { baseUrl?: string }) {
    this.baseUrl = (cfg?.baseUrl ?? DERIBIT_BASE_URL).replace(/\/+$/, '')
  }

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

  snapshot(): DeribitVolatilityIndexSnapshot | undefined {
    return this.cached
  }

  private finalizeSnapshot(args: {
    marketKey: string
    snapshot: DeribitVolatilityIndexSnapshot | undefined
  }): void {
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
      console.warn(`[deribitVolatilityIndex] unsupported slug, skipping: ${args.slug}`)
      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
      return
    }

    const asOfMs = t0Ms - 1
    if (!Number.isFinite(asOfMs) || asOfMs <= 0) {
      console.warn(`[deribitVolatilityIndex] invalid asOfMs=${asOfMs} slug=${args.slug}`)
      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
      return
    }

    const minStart = Math.min(
      ...RESOLUTIONS_SEC.map(
        (resSec) => expectedCloseTimeMs(asOfMs, resSec * 1000) - resSec * 1000 + 1,
      ),
    )

    try {
      const rows = await fetchDeribitVolatilityIndexData({
        currency: 'BTC',
        startTimestampMs: minStart,
        endTimestampMs: asOfMs,
        resolution: BASE_RESOLUTION_STR,
        baseUrl: this.baseUrl,
      })

      const candles60 = mapToBaseCandles(rows).filter((c) => c.closeTime <= asOfMs)
      const byResolutionSec = {} as Record<ResolutionSec, DvolCandle | null>
      const warnings: string[] = []

      for (const resSec of RESOLUTIONS_SEC) {
        const candle = aggregateCandle(candles60, resSec, asOfMs)
        byResolutionSec[resSec] = candle
        if (!candle) {
          warnings.push(`missing_${resSec}s`)
          continue
        }
        const resMs = resSec * 1000
        const expectedClose = expectedCloseTimeMs(asOfMs, resMs)
        const expectedOpen = expectedClose - resMs + 1
        if (candle.closeTime !== expectedClose || candle.openTime !== expectedOpen) {
          warnings.push(
            `misaligned_${resSec}s(open=${candle.openTime},close=${candle.closeTime},expectedOpen=${expectedOpen},expectedClose=${expectedClose})`,
          )
        }
      }

      const alignmentWarning = warnings.length > 0 ? warnings.join(' | ') : undefined
      const snapshot: DeribitVolatilityIndexSnapshot = {
        asOfTimeMs: t0Ms,
        currency: 'BTC',
        byResolutionSec,
        ...(alignmentWarning ? { alignmentWarning } : {}),
      }

      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot })

      const marketLabel = args.slug ?? args.marketId ?? args.marketKey
      const primary = byResolutionSec[300] ?? byResolutionSec[900] ?? byResolutionSec[3600] ?? null
      const closeStr = primary && Number.isFinite(primary.close) ? primary.close.toFixed(6) : 'null'
      const warn = alignmentWarning ? ` alignmentWarning=${alignmentWarning}` : ''
      console.log(`[dvol] market=${marketLabel} close=${closeStr}${warn}`)
    } catch (err) {
      console.error(
        `[deribitVolatilityIndex] failed to compute snapshot for slug=${args.slug}`,
        err,
      )
      this.finalizeSnapshot({ marketKey: args.marketKey, snapshot: undefined })
    }
  }
}
