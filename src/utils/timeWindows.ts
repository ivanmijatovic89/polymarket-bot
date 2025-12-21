export const FIFTEEN_MIN_MS = 15 * 60 * 1000

export function floorTo15mUtc(date: Date): Date {
  const ms = date.getTime()
  return new Date(Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS)
}

export function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

/**
 * Slug format used by Gamma for BTC 15m markets:
 * `btc-updown-15m-<epochSecondsOfWindowStart>`
 */
export function buildBtcUpDown15mSlug(date: Date): string {
  const windowStart = floorTo15mUtc(date)
  const epoch = toEpochSeconds(windowStart)
  return `btc-updown-15m-${epoch}`
}
