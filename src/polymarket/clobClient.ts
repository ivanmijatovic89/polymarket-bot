import { ClobClient } from '@polymarket/clob-client'
import { Wallet } from '@ethersproject/wallet'

import { loadPolymarketConfigFromEnv, type PolymarketConfig } from './config.js'

export type CreateClobClientOptions = {
  /**
   * Optional config override. If not provided, config will be loaded from environment variables.
   */
  config?: PolymarketConfig
  /**
   * Optional overrides for specific config values.
   */
  overrides?: {
    host?: string
    chainId?: number
    privateKey?: string
    creds?: PolymarketConfig['creds']
    signatureType?: number
    funder?: string
  }
}

/**
 * Creates a ClobClient instance with proper credentials format conversion.
 * Automatically loads config from environment variables if not provided.
 * Converts our internal format { apiKey, secret, passphrase } to ClobClient's expected format { key, secret, passphrase }.
 */
export function createClobClient(opts: CreateClobClientOptions = {}): ClobClient {
  // Load config from env if not provided
  const config = opts.config ?? loadPolymarketConfigFromEnv()
  const overrides = opts.overrides ?? {}

  // Use overrides or fall back to config values
  const host = overrides.host ?? config.clob.host
  const chainId = overrides.chainId ?? config.clob.chainId
  const privateKey = overrides.privateKey ?? config.privateKey
  const creds = overrides.creds ?? config.creds
  const signatureType = overrides.signatureType ?? config.clob.signatureType
  const funder = overrides.funder ?? config.clob.funder

  // Validate required fields
  if (!privateKey) {
    throw new Error(
      '[clob-client] Missing privateKey (PRIVATE_KEY or POLYMARKET_PRIVATE_KEY env var)',
    )
  }
  if (!creds) {
    throw new Error(
      '[clob-client] Missing credentials (POLYMARKET_API_KEY/POLYMARKET_API_SECRET/POLYMARKET_API_PASSPHRASE env vars)',
    )
  }
  if (!creds.apiKey || !creds.secret || !creds.passphrase) {
    throw new Error(
      '[clob-client] Invalid credentials: apiKey, secret, and passphrase are required',
    )
  }

  const wallet = new Wallet(privateKey)

  // ClobClient expects { key, secret, passphrase } format (not { apiKey, secret, passphrase })
  // Convert our format to what ClobClient expects
  const credsForClient = {
    key: creds.apiKey,
    secret: creds.secret,
    passphrase: creds.passphrase,
  }

  // clob-client constructor: (host, chainId, signer, creds, signatureType, funder?)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (ClobClient as any)(host, chainId, wallet, credsForClient, signatureType, funder)
}
