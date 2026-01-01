export class RetryLaterError extends Error {
  readonly waitMs: number
  constructor(message: string, waitMs: number) {
    super(message)
    this.name = 'RetryLaterError'
    this.waitMs = waitMs
  }
}

/**
 * Parse `btc-updown-15m-<epochSeconds>` into epoch ms of the window start.
 */
export function parseUpDown15mSlugEpochMs(args: { slug: string; symbol: string }): number | null {
  const sym = args.symbol.trim().toLowerCase()
  const m = new RegExp(`^${sym}-updown-15m-(\\d+)$`).exec(args.slug.trim().toLowerCase())
  if (!m) return null
  const seconds = Number(m[1])
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds * 1000
}

export function floorToWindowStart(tsMs: number, windowMs: number): number {
  return Math.floor(tsMs / windowMs) * windowMs
}

/**
 * Gamma can briefly return the previous 15m market around boundaries.
 * Use this helper to avoid subscribing to the previous-window market: throw RetryLaterError(waitMs)
 * so the caller can retry soon.
 */
export function throwIfPreviousWindowSlug(args: {
  slug: string
  symbol: string
  windowMs: number
  nowMs: number
  waitMs?: number
  messagePrefix?: string
}): void {
  const startMs = parseUpDown15mSlugEpochMs({ slug: args.slug, symbol: args.symbol })
  if (startMs === null) return
  const expectedStartMs = floorToWindowStart(args.nowMs, args.windowMs)
  if (startMs < expectedStartMs) {
    const prefix = args.messagePrefix ? `${args.messagePrefix} ` : ''
    throw new RetryLaterError(
      `${prefix}gamma still returning previous market slug=${args.slug}; waiting for current window market`,
      args.waitMs ?? 500,
    )
  }
}


