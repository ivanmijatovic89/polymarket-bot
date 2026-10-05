/** API cash/share quantities have six decimal places. Never sum them as floats. */
export const SCALE = 1_000_000n

export function units(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Expected a decimal amount, received ${String(value)}`)
  }
  const text = String(value)
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text)
  if (!match) throw new Error(`Invalid decimal: ${text}`)
  const fraction = match[3] ?? ''
  const exponent = Number(match[4] ?? 0)
  if (Math.abs(exponent) > 30) throw new Error(`Decimal exponent out of range: ${text}`)
  const shift = 6 + exponent - fraction.length
  let n = BigInt(`${match[2]}${fraction}`)
  if (shift >= 0) n *= 10n ** BigInt(shift)
  else {
    const divisor = 10n ** BigInt(-shift)
    if (n % divisor !== 0n) throw new Error(`Amount exceeds six-decimal precision: ${text}`)
    n /= divisor
  }
  return match[1] ? -n : n
}

export function decimal(n: bigint): string {
  const sign = n < 0n ? '-' : ''
  const abs = n < 0n ? -n : n
  return `${sign}${abs / SCALE}.${String(abs % SCALE).padStart(6, '0')}`
}

export function abs(n: bigint): bigint {
  return n < 0n ? -n : n
}

export function sum(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n)
}
