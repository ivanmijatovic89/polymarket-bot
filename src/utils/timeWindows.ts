export const FIFTEEN_MIN_MS = 15 * 60 * 1000

export function floorTo15mUtc(date: Date): Date {
  const ms = date.getTime()
  return new Date(Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS)
}

export function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

/**
 * Generic slug format used by Gamma for 15m up/down markets:
 * `<symbol>-updown-15m-<epochSecondsOfWindowStart>`
 */
export function buildUpDown15mSlug(symbol: string, date: Date): string {
  const sym = symbol.trim().toLowerCase()
  const windowStart = floorTo15mUtc(date)
  const epoch = toEpochSeconds(windowStart)
  return `${sym}-updown-15m-${epoch}`
}

/**
 * Slug format used by Gamma for BTC 15m markets:
 * `btc-updown-15m-<epochSecondsOfWindowStart>`
 */
export function buildBtcUpDown15mSlug(date: Date): string {
  return buildUpDown15mSlug('btc', date)
}
