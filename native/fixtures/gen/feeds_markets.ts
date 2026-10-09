/**
 * Fixture markets and engine constants shared by the feed slicer and the
 * feed golden generator (14 §13 V-1, V-2; 60 §7.1).
 */

/** Engine constants (14 F-47); equal to the TS defaults. */
export const LOOKBACK_MS = 300_000
export const BINANCE_TAIL_MS = 2_000
export const CHAINLINK_TAIL_MS = 5_000
/** `feeds-2026-07-21` defaults (14 §9). */
export const BINANCE_LATENCY_MS = 110
export const CHAINLINK_LATENCY_MS = 320
export const PRICE_TO_BEAT_LATENCY_MS = 2_700

export type FixtureMarket = {
  slug: string
  startMs: number
  endMs: number
  /** Window after the Chainlink coverage floor (2026-04-02). */
  chainlink: boolean
  /** Producer-resolved strike used as `gammaPriceToBeat.priceToBeat`. */
  priceToBeat: number
}

const m = (slug: string, chainlink: boolean, priceToBeat: number): FixtureMarket => {
  const startMs = Number(slug.split('-').pop()) * 1000
  return { slug, startMs, endMs: startMs + 900_000, chainlink, priceToBeat }
}

export const FIXTURE_MARKETS: FixtureMarket[] = [
  // PolyBolt era (after 2026-09-15), single day.
  m('btc-updown-15m-1789570800', true, 75812.35),
  // RTDS era; Telonex local clock steps backwards twice (14 F-8).
  m('btc-updown-15m-1785028500', true, 117234.51),
  // Pre-coverage midnight market: lookback spans two Binance days (14 F-12).
  m('btc-updown-15m-1773100800', false, 69420.5),
]
