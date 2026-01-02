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


