import type { PolymarketAuth } from './ws/marketWs.js'

export function parseOptionalAuth(): PolymarketAuth | undefined {
  const apiKey = process.env.POLYMARKET_API_KEY
  const secret = process.env.POLYMARKET_API_SECRET
  const passphrase = process.env.POLYMARKET_API_PASSPHRASE
  if (!apiKey || !secret || !passphrase) return undefined
  return { apiKey, secret, passphrase }
}
