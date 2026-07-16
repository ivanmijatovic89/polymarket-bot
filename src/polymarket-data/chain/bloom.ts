import { hexToBytes, keccak256, type Hex } from 'viem'

/** Ethereum log blooms may have false positives but never false negatives. */
export function bloomContains(bloom: Hex, value: Hex): boolean {
  const bloomBytes = hexToBytes(bloom)
  if (bloomBytes.length !== 256)
    throw new Error(`expected 256-byte bloom, got ${bloomBytes.length}`)
  const hash = hexToBytes(keccak256(value))
  for (let i = 0; i < 6; i += 2) {
    const bit = (((hash[i] ?? 0) << 8) | (hash[i + 1] ?? 0)) & 2047
    const byteIndex = 255 - Math.floor(bit / 8)
    const mask = 1 << (bit % 8)
    if (((bloomBytes[byteIndex] ?? 0) & mask) === 0) return false
  }
  return true
}

export function bloomMayContainEvent(bloom: Hex, addresses: Hex[], topic0s: Hex[]): boolean {
  return (
    addresses.some((address) => bloomContains(bloom, address)) &&
    topic0s.some((topic) => bloomContains(bloom, topic))
  )
}
