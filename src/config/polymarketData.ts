/**
 * Configuration for the polymarket-data sync pipeline
 * (`src/polymarket-data/`, tables `polymarket_*`).
 *
 * Import this AFTER `src/config/env.js` has loaded the dotenv files. The CLI
 * entry points do that via `import '../config/env.js'` at the top.
 *
 * Every knob is prefixed `POLYMARKET_DATA_` so it is unmistakably scoped to
 * this feature and never confused with the trading bot's `POLYMARKET_*` vars.
 */

const DEFAULT_BACKFILL_FROM_ISO = '2026-06-01T00:00:00Z'
const DEFAULT_GAMMA_API_URL = 'https://gamma-api.polymarket.com'
const DEFAULT_DATA_API_URL = 'https://data-api.polymarket.com'
const DEFAULT_MIN_CLOSE_AGE_MS = 60 * 60 * 1000

function envString(name: string, fallback: string): string {
  const raw = (process.env[name] ?? '').trim()
  return raw === '' ? fallback : raw
}

function envNumber(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim()
  if (raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[config/polymarketData] ${name} must be a positive number, got: ${raw}`)
  }
  return n
}

function parseBackfillFromMs(): number {
  const raw = envString('POLYMARKET_DATA_BACKFILL_FROM', DEFAULT_BACKFILL_FROM_ISO)
  const ms = new Date(raw).getTime()
  if (!Number.isFinite(ms)) {
    throw new Error(
      `[config/polymarketData] POLYMARKET_DATA_BACKFILL_FROM is not a valid ISO date: ${raw}`,
    )
  }
  return ms
}

/**
 * Lower bound (epoch ms) for markets we sync. Compared against
 * `polymarket_markets.market_start_ms`. Lower it and re-run the sync stages to
 * extend history backwards; already-synced markets are untouched.
 */
export const POLYMARKET_DATA_BACKFILL_FROM_MS = parseBackfillFromMs()

export const POLYMARKET_DATA_GAMMA_API_URL = envString(
  'POLYMARKET_DATA_GAMMA_API_URL',
  DEFAULT_GAMMA_API_URL,
)

export const POLYMARKET_DATA_API_URL = envString('POLYMARKET_DATA_API_URL', DEFAULT_DATA_API_URL)

/**
 * A market becomes eligible for trade/position sync only once it has been
 * closed for this long. Probes show the Data API is near-real-time (a market
 * closed ~16 min earlier already had ~complete trades), so this is a safety
 * margin, not a hard requirement.
 */
export const POLYMARKET_DATA_MIN_CLOSE_AGE_MS = envNumber(
  'POLYMARKET_DATA_MIN_CLOSE_AGE_MS',
  DEFAULT_MIN_CLOSE_AGE_MS,
)

/**
 * Requests/second budgets. Documented API caps: Data API `/trades` 200 req/10s
 * (= 20/s); general Data API 1000 req/10s (= 100/s), which covers `/activity`.
 *
 * `/activity` is what deep-backfill hammers — hundreds of calls per capped
 * market — so its budget is the main throughput lever. Defaults leave headroom
 * (a 429 is honoured with backoff and doesn't burn the retry budget), and each
 * can be raised via env when a big one-time backfill needs to run faster.
 */
export const POLYMARKET_DATA_GAMMA_RPS = envNumber('POLYMARKET_DATA_GAMMA_RPS', 10)
export const POLYMARKET_DATA_TRADES_RPS = envNumber('POLYMARKET_DATA_TRADES_RPS', 15)
export const POLYMARKET_DATA_ACTIVITY_RPS = envNumber('POLYMARKET_DATA_ACTIVITY_RPS', 60)
