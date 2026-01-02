export function fmtCents(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  const cents = n * 100
  return `${cents}`
}


