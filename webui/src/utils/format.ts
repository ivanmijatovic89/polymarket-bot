export type FmtCentsOptions = {
  /**
   * If true, formats using toFixed(digits).
   * If false/omitted, returns the raw numeric string (previous behavior).
   */
  fixed?: boolean
  /** Used only when fixed=true. Default: 2 */
  digits?: number
}

export function fmtCents(n: number | undefined | null, opts?: FmtCentsOptions): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  const cents = n * 100
  const fixed = Boolean(opts?.fixed)
  if (!fixed) return `${cents}`
  const digits = typeof opts?.digits === 'number' && Number.isFinite(opts.digits) ? Math.max(0, Math.floor(opts.digits)) : 2
  return cents.toFixed(digits)
}

export type FmtPriceOptions = {
  /**
   * Number of decimal places to show.
   * - 0 => rounds to whole numbers
   * - 2 => typical USD/USDT
   *
   * Default: 2
   */
  decimals?: number
}

/**
 * Formats a number with thousands separators, e.g. 1000.55 => "1,000.55".
 * Uses en-US formatting to match the requested output.
 */
export function fmtPrice(n: number | undefined | null, opts?: FmtPriceOptions): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  const decimalsRaw = typeof opts?.decimals === 'number' && Number.isFinite(opts.decimals) ? opts.decimals : 2
  const decimals = Math.max(0, Math.floor(decimalsRaw))
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

/**
 * Returns Tailwind classes to color text red/green based on sign.
 * Uses the same colors as Open Orders "side" (BUY/SELL) labels.
 */
export function clsRedGreen(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  if (n > 0) return 'font-semibold text-green-400'
  if (n < 0) return 'font-semibold text-red-400'
  return ''
}


