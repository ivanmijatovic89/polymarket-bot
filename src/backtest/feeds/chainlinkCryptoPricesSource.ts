import { fileExists } from '../../utils/fs.js'
import { getInMemoryDuckDb, sqlQuote } from '../../utils/duckdb.js'
import { utcDateOf, utcDatesCovering } from '../../binance/paths.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM,
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  cryptoPricesDayPath,
} from '../../telonex/cryptoPrices/paths.js'

/**
 * A TWO-CLOCK time-indexed series for as-of lookups over Chainlink rounds.
 *
 * - `tsMs` — the chainlink ROUND time (`timestamp_us // 1000`). This is what
 *   live strategies see as `RtdsPricePoint.tsMs` (`payload.timestamp`), so the
 *   emitted point must carry it.
 * - `visibleAtMs` — the Polymarket BROADCAST time (`server_timestamp_us //
 *   1000`). Live, the bot cannot see a round before Polymarket broadcasts it
 *   (observed ~1s after the round time), so replay visibility keys on
 *   `visibleAtMs + latencyOffset`, never on the round time.
 *
 * Sorted by broadcast time (ties by round time): the provider's monotone
 * cursor advances on VISIBILITY order. The emitted round-`tsMs` may therefore
 * occasionally step backwards across consecutive points — that is live-correct
 * (live last-write-wins in broadcast order).
 */
export type TwoClockAsOfSeries = {
  tsMs: Float64Array
  visibleAtMs: Float64Array
  value: Float64Array
  length: number
}

/**
 * Post-window tail loaded beyond `endMs`: the replay visibility clock is the
 * recorded LOCAL receive time, which runs past the exchange-stamped window
 * end, and broadcast lags the round by ~1s on top — so the final ticks can
 * legitimately see rounds from just after `endMs`, exactly like live. The
 * tail only widens the SQL range, not the day-file set: for a window ending
 * exactly at UTC midnight the tail rounds live in the next day's file, which
 * is deliberately NOT required — that bounded residual (≤ tail of rounds on
 * the final ticks) is the accepted price of not hard-erroring every fresh
 * midnight-ending market.
 */
const SERIES_TAIL_MS = 5_000

/**
 * Load the historical Chainlink rounds covering `[startMs - lookbackMs, endMs]`
 * from the Telonex `crypto_prices` day files.
 *
 * The series is SEEDED with the single latest round before the range (when one
 * exists in the covered day files): live, the feeds store retains the last
 * received price indefinitely, so even a quiet gap longer than the lookback
 * must still produce a price at the first tick.
 *
 * Missing-data policy (project decision, stricter than the priceToBeat feed):
 * a strategy that REQUESTS the chainlink feed and cannot get real data is a
 * HARD ERROR in every case — pre-coverage markets, publication-lag days, and
 * missing files each fail with a cause-specific message naming the exact
 * remedy. No silent feed-less replay, ever.
 */
export async function loadChainlinkCryptoPricesSeries(args: {
  assetId: string
  startMs: number
  endMs: number
  lookbackMs: number
}): Promise<TwoClockAsOfSeries> {
  const fromMs = args.startMs - args.lookbackMs

  if (args.startMs < CRYPTO_PRICES_COVERAGE_FROM_MS) {
    throw new Error(
      `[backtest:feeds] market window starts ${new Date(args.startMs).toISOString()}, before ` +
        `crypto_prices coverage (${CRYPTO_PRICES_COVERAGE_FROM}) — the chainlink feed cannot exist for ` +
        `this market. Exclude pre-coverage markets (--from-ms ${CRYPTO_PRICES_COVERAGE_FROM_MS}) or drop ` +
        `the rtdsCryptoPrices request from the strategy.`,
    )
  }

  const dates = utcDatesCovering(Math.max(fromMs, CRYPTO_PRICES_COVERAGE_FROM_MS), args.endMs)
  const paths: string[] = []
  const missing: string[] = []
  for (const d of dates) {
    const p = cryptoPricesDayPath(args.assetId, d)
    if (await fileExists(p)) paths.push(p)
    else missing.push(d)
  }
  if (missing.length > 0) {
    const todayUtc = utcDateOf(Date.now())
    const yesterdayUtc = utcDateOf(Date.now() - 86_400_000)
    const withinLag = missing.every((d) => d === todayUtc || d === yesterdayUtc)
    if (withinLag) {
      throw new Error(
        `[backtest:feeds] Telonex crypto_prices day file(s) for ${args.assetId} not available yet: ` +
          `${missing.join(', ')} — Telonex publishes daily after midnight UTC. Run ` +
          `\`npm run telonex:crypto-prices:download -- --asset ${args.assetId} --sync\` later and retry ` +
          `this market.`,
      )
    }
    throw new Error(
      `[backtest:feeds] missing Telonex crypto_prices day file(s) for ${args.assetId}: ${missing.join(', ')}. ` +
        `Worker machines: npm run telonex:crypto-prices:download-r2-to-local -- --asset ${args.assetId} ` +
        `(pull from the R2 mirror). Producer machine: npm run telonex:crypto-prices:download -- ` +
        `--asset ${args.assetId} --from ${missing[0]} --to ${missing[missing.length - 1]} (direct Telonex download)`,
    )
  }

  const db = await getInMemoryDuckDb()
  const conn = await db.connect()
  try {
    const fileList = paths.map(sqlQuote).join(', ')
    // Seed: the latest round strictly before the range start, in broadcast
    // order (what live would have retained in the store at that moment).
    // Prepended in JS so the series stays sorted regardless of SQL execution.
    const seedResult = await conn.run(
      `SELECT timestamp_us // 1000, server_timestamp_us // 1000, CAST(price AS DOUBLE)
       FROM read_parquet([${fileList}])
       WHERE timestamp_us < ${Math.floor(fromMs)} * 1000
       ORDER BY server_timestamp_us DESC, timestamp_us DESC LIMIT 1`,
    )
    const seedRow = seedResult.chunkCount > 0 ? seedResult.getChunk(0).getRows()[0] : undefined
    const result = await conn.run(
      `SELECT timestamp_us // 1000, server_timestamp_us // 1000, CAST(price AS DOUBLE)
       FROM read_parquet([${fileList}])
       WHERE timestamp_us BETWEEN ${Math.floor(fromMs)} * 1000 AND ${Math.floor(args.endMs + SERIES_TAIL_MS)} * 1000
       ORDER BY server_timestamp_us, timestamp_us`,
    )

    const tsChunks: Float64Array[] = []
    const visChunks: Float64Array[] = []
    const pxChunks: Float64Array[] = []
    let total = 0
    if (seedRow) {
      tsChunks.push(Float64Array.of(Number(seedRow[0])))
      visChunks.push(Float64Array.of(Number(seedRow[1])))
      pxChunks.push(Float64Array.of(Number(seedRow[2])))
      total += 1
    }
    for (let c = 0; c < result.chunkCount; c++) {
      const rows = result.getChunk(c).getRows()
      const ts = new Float64Array(rows.length)
      const vis = new Float64Array(rows.length)
      const px = new Float64Array(rows.length)
      for (let i = 0; i < rows.length; i++) {
        ts[i] = Number(rows[i]?.[0])
        vis[i] = Number(rows[i]?.[1])
        px[i] = Number(rows[i]?.[2])
        // A NULL/zero broadcast time would split the provider (treats it as
        // visible-from-t0) from the synthetic-tick schedule (drops it as
        // pre-window) — refuse corrupt rows instead of diverging silently.
        if (!Number.isFinite(vis[i]!) || vis[i]! <= 0) {
          throw new Error(
            `[backtest:feeds] NULL/invalid server_timestamp_us in crypto_prices day file(s) for ${args.assetId} ` +
              `(round ts=${ts[i]}) — corrupt row; re-download with --force`,
          )
        }
      }
      tsChunks.push(ts)
      visChunks.push(vis)
      pxChunks.push(px)
      total += rows.length
    }
    if (total === 0) {
      // Files exist but contain no rounds up to the window end — empty or
      // corrupt data. Same policy: hard error over a silent feed-less replay.
      throw new Error(
        `[backtest:feeds] Telonex crypto_prices day file(s) for ${args.assetId} contain no rounds up to ` +
          `${new Date(args.endMs).toISOString()} (${dates.join(', ')}) — corrupt/empty day file(s)? ` +
          `Re-download on the producer with: npm run telonex:crypto-prices:download -- ` +
          `--asset ${args.assetId} --from ${dates[0]} --to ${dates[dates.length - 1]} --force`,
      )
    }
    const tsMs = new Float64Array(total)
    const visibleAtMs = new Float64Array(total)
    const value = new Float64Array(total)
    let off = 0
    for (let i = 0; i < tsChunks.length; i++) {
      tsMs.set(tsChunks[i]!, off)
      visibleAtMs.set(visChunks[i]!, off)
      value.set(pxChunks[i]!, off)
      off += tsChunks[i]!.length
    }
    assertNoDataHoleInWindow({
      assetId: args.assetId,
      roundTsMs: tsMs,
      startMs: args.startMs,
      endMs: args.endMs,
    })
    return { tsMs, visibleAtMs, value, length: total }
  } finally {
    conn.closeSync()
  }
}

/**
 * Maximum tolerated stale span inside the market window before the market is
 * rejected. Chainlink rounds arrive ~1/s, so any span ≥5min is an upstream
 * outage (34 such gaps exist in Apr–Jul 2026, largest ~8h — see
 * data-coverage.md). Policy (project decision): a strategy that requests the
 * chainlink feed must FAIL on such markets rather than silently trade a
 * frozen price — even though live bots in those windows also saw the stale
 * value, research results from them would be quietly polluted. Set the env
 * var to 0 to disable (accept stale replay, the live-faithful behavior).
 */
const DEFAULT_MAX_GAP_MS = 300_000

/**
 * Hard-error when the largest round-to-round stale span clipped to
 * `[startMs, endMs]` reaches the threshold. Uses the ROUND clock (the oracle
 * series itself); the pre-window seed bounds staleness at the window start and
 * the post-window tail bounds it at the end.
 */
function assertNoDataHoleInWindow(args: {
  assetId: string
  roundTsMs: Float64Array
  startMs: number
  endMs: number
}): void {
  const raw = process.env.BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS?.trim()
  const parsed = raw ? Number(raw) : NaN
  const maxGapMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_GAP_MS
  if (maxGapMs === 0) return // explicitly disabled — stale replay accepted

  // Round timestamps ascending (the series is sorted by broadcast time).
  const sorted = Array.from(args.roundTsMs).sort((a, b) => a - b)
  let worstSpan = 0
  let worstFrom = args.startMs
  let prev = Number.NEGATIVE_INFINITY // no round before the window → span runs from startMs
  for (let i = 0; i <= sorted.length; i++) {
    const next = i < sorted.length ? sorted[i]! : Number.POSITIVE_INFINITY
    const spanFrom = Math.max(prev, args.startMs)
    const spanTo = Math.min(next, args.endMs)
    if (spanTo - spanFrom > worstSpan) {
      worstSpan = spanTo - spanFrom
      worstFrom = spanFrom
    }
    prev = next
    if (next >= args.endMs) break
  }
  if (worstSpan >= maxGapMs) {
    throw new Error(
      `[backtest:feeds] MISSING chainlink data for ${args.assetId}: the market window ` +
        `[${new Date(args.startMs).toISOString()} .. ${new Date(args.endMs).toISOString()}] contains a ` +
        `${(worstSpan / 60_000).toFixed(1)}-minute hole in the oracle series (from ` +
        `${new Date(worstFrom).toISOString()}) — an upstream Polymarket/Telonex outage; the data does not ` +
        `exist anywhere. Exclude this market from the batch (upstream gap list: docs/datasets/data-coverage.md), ` +
        `or set BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS=0 to accept replaying on the frozen last-known price ` +
        `(what live bots saw during the outage).`,
    )
  }
}
