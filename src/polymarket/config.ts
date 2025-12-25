export const GAMMA_DEFAULT = 'https://gamma-api.polymarket.com'

export type PolymarketCredentials = {
  apiKey: string
  secret: string
  passphrase: string
}

export type PolymarketConfig = {
  creds?: PolymarketCredentials
  privateKey?: string
  ws: { marketUrl: string; userUrl: string }
  clob: {
    host: string
    chainId: number
    pollIntervalMs: number
    signatureType: number
    funder?: string
  }
  gamma: { baseUrl: string }
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : undefined
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = env(name)
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const n = parseIntEnv(name, fallback)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback
  return n
}

function loadOptionalCredentialsFromEnv(): PolymarketCredentials | undefined {
  // Prefer POLYMARKET_* (used elsewhere already), but allow CLOB_* fallback for convenience.
  const apiKey = env('POLYMARKET_API_KEY') ?? env('CLOB_API_KEY')
  const secret = env('POLYMARKET_API_SECRET') ?? env('CLOB_SECRET')
  const passphrase = env('POLYMARKET_API_PASSPHRASE') ?? env('CLOB_PASS_PHRASE')
  if (!apiKey || !secret || !passphrase) return undefined
  return { apiKey, secret, passphrase }
}

function loadOptionalPrivateKeyFromEnv(): string | undefined {
  return env('PRIVATE_KEY') ?? env('POLYMARKET_PRIVATE_KEY')
}

export function loadPolymarketConfigFromEnv(): PolymarketConfig {
  const marketUrl =
    env('POLYMARKET_WS_URL') ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
  const userUrl =
    env('POLYMARKET_USER_WS_URL') ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/user'

  const host = env('CLOB_API_URL') ?? 'https://clob.polymarket.com'
  const chainId = parseIntEnv('CLOB_CHAIN_ID', 137)
  const pollIntervalMs = parsePositiveIntEnv('CLOB_POLL_INTERVAL_MS', 1_000)
  const signatureType = parseIntEnv('CLOB_SIGNATURE_TYPE', 0)
  const funder = env('CLOB_FUNDER')

  const gammaBaseUrl = env('GAMMA_API_BASE_URL') ?? GAMMA_DEFAULT

  const out: PolymarketConfig = {
    ws: { marketUrl, userUrl },
    clob: { host, chainId, pollIntervalMs, signatureType, ...(funder ? { funder } : {}) },
    gamma: { baseUrl: gammaBaseUrl },
  }

  const creds = loadOptionalCredentialsFromEnv()
  if (creds) out.creds = creds
  const privateKey = loadOptionalPrivateKeyFromEnv()
  if (privateKey) out.privateKey = privateKey

  return out
}
