import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root, derived from this file's location (src/binance/paths.ts), so all
// Binance dataset paths resolve identically regardless of CWD — backtest
// workers, cron jobs and CLIs never have to `cd` into the repo first.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * SINGLE SOURCE OF TRUTH for the on-disk layout of Binance historical data.
 *
 *   data/binance/aggTrades/<PAIR>/<PAIR>-aggTrades-YYYY-MM-DD.parquet   historical (converted dumps)
 *   data/binance/recordings/aggTrades/<PAIR>/...                        live WS recordings
 *   data/binance/tmp/                                                   download/convert scratch
 *
 * Root overridable via BINANCE_DATA_BASE_DIR (relative values anchor at repo root).
 */
export function binanceDataBaseDir(): string {
  const base = process.env.BINANCE_DATA_BASE_DIR?.trim() || 'data/binance'
  return path.isAbsolute(base) ? base : path.resolve(REPO_ROOT, base)
}

/** Local directory holding a pair's converted day files. */
export function aggTradesDayDir(pair: string): string {
  return path.join(binanceDataBaseDir(), 'aggTrades', pair)
}

function aggTradesDayFilename(pair: string, isoDate: string): string {
  return `${pair}-aggTrades-${isoDate}.parquet`
}

export function aggTradesDayPath(pair: string, isoDate: string): string {
  return path.join(aggTradesDayDir(pair), aggTradesDayFilename(pair, isoDate))
}

/**
 * R2 mirror layout for converted day files. Deliberately identical to the
 * local layout under the data root, so producer upload / worker download need
 * no DB index — the (pair, date) pair fully determines both sides.
 */
export function aggTradesR2Prefix(pair: string): string {
  return `binance/aggTrades/${pair}/`
}

export function aggTradesR2Key(pair: string, isoDate: string): string {
  return `${aggTradesR2Prefix(pair)}${aggTradesDayFilename(pair, isoDate)}`
}

/**
 * Parse the ISO date out of a day-file name or R2 key for THIS pair; null for
 * anything else. Anchored on the pair so a stray file for another pair (or a
 * `.tmp`, recording, or backup copy) never counts as a local day file —
 * `--sync`'s range derivation and the R2 mirror scans depend on that.
 */
export function isoDateFromAggTradesFilename(name: string, pair: string): string | null {
  const base = path.basename(name)
  // pairFromFeedSymbol guarantees pair is /^[A-Z0-9]+$/, safe inside a regex.
  const m = base.match(new RegExp(`^${pair}-aggTrades-(\\d{4}-\\d{2}-\\d{2})\\.parquet$`))
  return m?.[1] ?? null
}

export function aggTradesDumpUrl(pair: string, isoDate: string): { zip: string; checksum: string } {
  const zip = `https://data.binance.vision/data/spot/daily/aggTrades/${pair}/${pair}-aggTrades-${isoDate}.zip`
  return { zip, checksum: `${zip}.CHECKSUM` }
}

export function recordingsDir(pair: string): string {
  return path.join(binanceDataBaseDir(), 'recordings', 'aggTrades', pair)
}

export function recordingHourPath(pair: string, isoDate: string, hour: number): string {
  const hh = String(hour).padStart(2, '0')
  return path.join(recordingsDir(pair), `${pair}-aggTrades-live-${isoDate}T${hh}.parquet`)
}

export function recordingStatusPath(pair: string): string {
  return path.join(recordingsDir(pair), `${pair}-status.jsonl`)
}

export function tmpDir(): string {
  return path.join(binanceDataBaseDir(), 'tmp')
}

/**
 * Map a live feed symbol (Binance WS stream symbol, lowercase, e.g. "btcusdt")
 * to the dump/pair spelling ("BTCUSDT"). The WS client lowercases; dumps are
 * uppercase — this is the only place that CASING conversion lives (the default
 * quote-asset rule lives in `defaultBinanceFeedSymbol` below).
 */
export function pairFromFeedSymbol(feedSymbol: string): string {
  const s = feedSymbol.trim().toUpperCase()
  if (!/^[A-Z0-9]+$/.test(s)) {
    throw new Error(`[binance] invalid feed symbol: ${JSON.stringify(feedSymbol)}`)
  }
  return s
}

/**
 * Default Binance WS feed symbol for a traded market symbol ("btc" → "btcusdt").
 * The <SYM>USDT quote rule lives ONLY here (and via `defaultBinancePairForSymbol`):
 * live wiring, backtest wiring + preflight, and every CLI `--symbol` flag derive
 * their default through these helpers, so live and replay can never disagree
 * on the derived pair.
 */
export function defaultBinanceFeedSymbol(marketSymbol: string): string {
  return `${marketSymbol.trim().toLowerCase()}usdt`
}

/** Default dump/pair spelling for a traded market symbol ("btc" → "BTCUSDT"). */
export function defaultBinancePairForSymbol(marketSymbol: string): string {
  return pairFromFeedSymbol(defaultBinanceFeedSymbol(marketSymbol))
}

/** UTC calendar date (YYYY-MM-DD) for an epoch-ms timestamp. */
export function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Every UTC calendar date whose daily dump can contain trades in [startMs, endMs).
 * `endMs` is EXCLUSIVE at day boundaries: a market window ending exactly at UTC
 * midnight (every 23:45 15m market) must NOT require the next day's dump — that
 * file only exists ~1 day later, so demanding it would hard-error the freshest
 * markets even on a fully synced machine, and the only trades it could
 * contribute (ts == endMs exactly) are never visible under the feed's latency
 * offset anyway.
 */
export function utcDatesCovering(startMs: number, endMs: number): string[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error(`[binance] invalid time range: startMs=${startMs} endMs=${endMs}`)
  }
  const DAY_MS = 86_400_000
  const out: string[] = []
  let dayStart = Math.floor(startMs / DAY_MS) * DAY_MS
  do {
    out.push(utcDateOf(dayStart))
    dayStart += DAY_MS
  } while (dayStart < endMs)
  return out
}

/** Enumerate YYYY-MM-DD dates from `from` to `to`, inclusive. */
export function utcDateRange(from: string, to: string): string[] {
  const startMs = Date.parse(`${from}T00:00:00Z`)
  const endMs = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error(`[binance] invalid date(s): from=${from} to=${to} (expected YYYY-MM-DD)`)
  }
  if (endMs < startMs) throw new Error(`[binance] --to ${to} is before --from ${from}`)
  const DAY_MS = 86_400_000
  const out: string[] = []
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) out.push(utcDateOf(ms))
  return out
}
