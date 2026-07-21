import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TELONEX_DOWNLOAD_BASE } from '../telonexHttp.js'

// Repo root, derived from this file's location (src/telonex/cryptoPrices/paths.ts),
// so all dataset paths resolve identically regardless of CWD — backtest workers,
// cron jobs and CLIs never have to `cd` into the repo first.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * SINGLE SOURCE OF TRUTH for the on-disk / R2 layout of the Telonex
 * `crypto_prices` dataset (Chainlink oracle ticks Polymarket resolves with).
 *
 *   data/telonex/crypto_prices/<asset_id>/<asset_id>-crypto-prices-YYYY-MM-DD.parquet  raw Telonex day files
 *   data/telonex/crypto_prices/recordings/<asset_id>/...                               live RTDS recordings
 *   R2: telonex/crypto_prices/<asset_id>/<same filename>
 *
 * The channel is single-asset: `asset_id` is the lowercase symbol without the
 * slash (`btcusd`), NOT a market slug or outcome token. Files are stored
 * exactly as delivered by Telonex (no conversion) — the backtest loader casts
 * price/timestamps in SQL at read time.
 *
 * Root overridable via TELONEX_CRYPTO_PRICES_BASE_DIR (relative values anchor
 * at repo root).
 */
export function cryptoPricesBaseDir(): string {
  const base = process.env.TELONEX_CRYPTO_PRICES_BASE_DIR?.trim() || 'data/telonex/crypto_prices'
  return path.isAbsolute(base) ? base : path.resolve(REPO_ROOT, base)
}

/**
 * First UTC date with `crypto_prices` coverage (per Telonex docs and the
 * repo's data-coverage table). Markets before this CANNOT have the Chainlink
 * feed in backtests — requesting it for them is a hard error by policy.
 */
export const CRYPTO_PRICES_COVERAGE_FROM = '2026-04-02'
export const CRYPTO_PRICES_COVERAGE_FROM_MS = Date.parse(`${CRYPTO_PRICES_COVERAGE_FROM}T00:00:00Z`)

/** The 7 reference assets Polymarket publishes Chainlink rounds for. */
export const CRYPTO_PRICES_ASSET_IDS = [
  'btcusd',
  'ethusd',
  'solusd',
  'xrpusd',
  'bnbusd',
  'dogeusd',
  'hypeusd',
] as const

export function cryptoPricesDayDir(assetId: string): string {
  return path.join(cryptoPricesBaseDir(), assetId)
}

export function cryptoPricesDayFilename(assetId: string, isoDate: string): string {
  return `${assetId}-crypto-prices-${isoDate}.parquet`
}

export function cryptoPricesDayPath(assetId: string, isoDate: string): string {
  return path.join(cryptoPricesDayDir(assetId), cryptoPricesDayFilename(assetId, isoDate))
}

export function cryptoPricesR2Prefix(assetId: string): string {
  return `telonex/crypto_prices/${assetId}/`
}

export function cryptoPricesR2Key(assetId: string, isoDate: string): string {
  return `${cryptoPricesR2Prefix(assetId)}${cryptoPricesDayFilename(assetId, isoDate)}`
}

/**
 * Parse the ISO date out of a canonical day-file name (local basename or R2
 * key); null for anything else. Anchored to the exact `<assetId>-crypto-prices-`
 * spelling so foreign/backup/nested keys under the prefix can never be
 * mistaken for day files (same rationale as the binance dataset).
 */
export function isoDateFromCryptoPricesFilename(name: string, assetId: string): string | null {
  const base = name.split('/').pop() ?? name
  const m = base.match(new RegExp(`^${assetId}-crypto-prices-(\\d{4}-\\d{2}-\\d{2})\\.parquet$`))
  return m?.[1] ?? null
}

/** Telonex download URL for one (asset, UTC date) day file. */
export function cryptoPricesDownloadUrl(assetId: string, isoDate: string): string {
  return `${TELONEX_DOWNLOAD_BASE}/crypto_prices/${isoDate}?asset_id=${encodeURIComponent(assetId)}`
}

/**
 * Market symbol → channel asset id (`btc` → `btcusd`). The `<sym>usd` rule
 * lives ONLY here. Accepts already-valid asset ids unchanged so CLIs can take
 * either spelling.
 */
export function assetIdForSymbol(marketSymbol: string): string {
  const s = marketSymbol.trim().toLowerCase()
  if (!/^[a-z0-9]+$/.test(s) || s.length === 0) {
    throw new Error(`[crypto-prices] invalid symbol: ${JSON.stringify(marketSymbol)}`)
  }
  return s.endsWith('usd') ? s : `${s}usd`
}

/** Market symbol → live RTDS chainlink feed symbol (`btc` → `btc/usd`) — mirrors trading-bot's derivation. */
export function chainlinkFeedSymbolForMarketSymbol(marketSymbol: string): string {
  const s = marketSymbol.trim().toLowerCase()
  if (!/^[a-z0-9]+$/.test(s) || s.length === 0) {
    throw new Error(`[crypto-prices] invalid symbol: ${JSON.stringify(marketSymbol)}`)
  }
  return `${s}/usd`
}

/** RTDS chainlink feed symbol → channel asset id (`btc/usd` → `btcusd`); null if unparseable. */
export function assetIdFromChainlinkFeedSymbol(feedSymbol: string): string | null {
  const m = feedSymbol
    .trim()
    .toLowerCase()
    .match(/^([a-z0-9]+)\/usd$/)
  return m ? `${m[1]}usd` : null
}

export function recordingsDir(assetId: string): string {
  return path.join(cryptoPricesBaseDir(), 'recordings', assetId)
}

export function recordingHourPath(assetId: string, isoDate: string, hour: number): string {
  const hh = String(hour).padStart(2, '0')
  return path.join(recordingsDir(assetId), `${assetId}-rtds-chainlink-${isoDate}T${hh}.parquet`)
}

export function recordingStatusPath(assetId: string): string {
  return path.join(recordingsDir(assetId), `${assetId}-status.jsonl`)
}
