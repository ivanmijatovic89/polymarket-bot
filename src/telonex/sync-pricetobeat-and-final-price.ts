import '../config/env.js'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { sleep } from '../utils/sleep.js'
import { closeDb } from '../db/index.js'
import {
  countMarketsForGammaBackfill,
  listMarketsForGammaBackfill,
  updateGammaMetadata,
} from '../db/telonexMarkets.js'
import { fetchClosedGammaMarketsBySlugs, fetchGammaMarketBySlug } from '../polymarket/gamma.js'
import {
  GAMMA_PRICE_TO_BEAT_FROM_MS,
  parseGammaEventMetadata,
} from '../polymarket/gammaEventMetadata.js'

/**
 * Backfill `telonex_markets.price_to_beat` / `final_price` from Gamma
 * `events[].eventMetadata` (the Chainlink open/strike and settle price).
 *
 *   npm run telonex:sync-pricetobeat-and-final-price
 *   npm run telonex:sync-pricetobeat-and-final-price -- --limit 5000 --dry-run
 *   npm run telonex:sync-pricetobeat-and-final-price -- --refetch-nulls   # recovery pass
 *
 * `--refetch-nulls` re-fetches rows already stamped but with a NULL strike —
 * the recovery path when a transient Gamma inconsistency (empty 200 response,
 * lagging eventMetadata writer) was recorded as a permanent "no data". Genuine
 * holes simply re-stamp null; recovered strikes fill in. Scope it with
 * --from/--to/--limit to avoid re-fetching the known permanent holes.
 *
 * Batched (default 20 slugs per Gamma request, `closed=true`) with polite
 * spacing and exponential backoff on rate-limit/challenge responses — Gamma
 * sits behind Cloudflare and challenges bursty clients.
 *
 * Resumable and idempotent: only rows with `gamma_metadata_synced_at IS NULL`
 * are fetched, oldest first; every DEFINITIVE answer stamps the timestamp
 * (null prices = Gamma genuinely has no data — never re-fetched). Transport
 * errors never stamp, so a crashed run resumes cleanly. Only markets whose
 * window ended ≥3h ago are touched: settled markets are reliably `closed=true`
 * on Gamma, so an absent slug there is a real catalog divergence, not a
 * still-open market.
 *
 * Default floor is the measured priceToBeat epoch (~2026-02-19; markets before
 * can never have the field — docs/datasets/data-coverage.md). Run after
 * `telonex:sync` (cron) to pick up newly cataloged markets.
 */

type Args = {
  slugPatterns?: string[]
  fromMs: number
  toMs?: number
  limit?: number
  batchSize: number
  dryRun: boolean
  refetchNulls: boolean
}

function parseDateMs(raw: string, flag: string): number {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    // Epoch ms only (13 digits) — a compact date like `20260301` would
    // otherwise silently parse as ~1970 and widen the window to the whole
    // catalog (hours of rate-limited Gamma fetches the floor exists to avoid).
    if (n < 1_000_000_000_000) {
      throw new Error(
        `[gamma-backfill] ${flag}: ambiguous numeric value "${raw}" — pass epoch milliseconds (13 digits) or an ISO date like 2026-03-01`,
      )
    }
    return n
  }
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) {
    throw new Error(`[gamma-backfill] ${flag} must be an ISO date or epoch ms, got: ${raw}`)
  }
  return ms
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[gamma-backfill] ${flag} must be a positive integer, got: ${raw}`)
  }
  return n
}

function parseArgs(argv: string[]): Args {
  let fromMs = GAMMA_PRICE_TO_BEAT_FROM_MS
  let slugPatterns: string[] | undefined
  let toMs: number | undefined
  let limit: number | undefined
  let batchSize = 20
  let dryRun = false
  let refetchNulls = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`missing value for ${a}`)
      return v
    }
    if (a === '--from') fromMs = parseDateMs(next(), '--from')
    else if (a === '--to') toMs = parseDateMs(next(), '--to')
    else if (a === '--limit') limit = parsePositiveInt(next(), '--limit')
    else if (a === '--batch-size')
      batchSize = Math.min(50, parsePositiveInt(next(), '--batch-size'))
    else if (a === '--slug-pattern') {
      const parts = next()
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      if (parts.length > 0) slugPatterns = parts
    } else if (a === '--dry-run') dryRun = true
    else if (a === '--refetch-nulls') refetchNulls = true
    else {
      console.error(
        'Usage: npm run telonex:sync-pricetobeat-and-final-price -- ' +
          '[--from <iso|ms>] [--to <iso|ms>] [--slug-pattern btc-updown-15m-%] [--limit N] [--batch-size 20] [--dry-run] [--refetch-nulls]',
      )
      process.exit(2)
    }
  }
  return {
    fromMs,
    ...(slugPatterns !== undefined ? { slugPatterns } : {}),
    ...(toMs !== undefined ? { toMs } : {}),
    ...(limit ? { limit } : {}),
    batchSize,
    dryRun,
    refetchNulls,
  }
}

/** Spacing between Gamma batch requests (~2.5 req/s — Cloudflare-friendly). */
const REQUEST_SPACING_MS = 400
/** Backoff schedule when Gamma rate-limits/challenges (HTTP error or non-JSON). */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 90_000]
/** Only touch markets whose window ended at least this long ago (settled ⇒ closed on Gamma). */
const SETTLED_MARGIN_MS = 3 * 3_600_000

/**
 * Run one Gamma request with the shared backoff schedule. Returns null only
 * when aborted mid-backoff (callers must check the abort flag; a null Gamma
 * result is a different `T`-level null). Used by BOTH the batch request and
 * the per-slug fallback — an unretried fallback burst would trip the exact
 * Cloudflare rate limit the batch path backs off from, and its throw would
 * kill the whole run.
 */
async function withGammaRetry<T>(
  what: string,
  fn: () => Promise<T>,
  isAborted: () => boolean,
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) throw err
      const delay = RETRY_DELAYS_MS[attempt]!
      console.warn(
        `[gamma-backfill] ${what} failed (${err instanceof Error ? err.message.slice(0, 120) : err}) — backing off ${delay / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
      )
      await sleep(delay)
      if (isAborted()) return null
    }
  }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'gamma-backfill' })
  const args = parseArgs(process.argv.slice(2))

  // Settled gate: only markets whose window ENDED ≥3h ago are queried against
  // closed=true (an open market's absence there would be misread as "not on
  // Gamma" and stamped null permanently). Filtered on window END in SQL —
  // start-based clamping would let a still-open 4h/1d market through.
  const settledBeforeMs = Date.now() - SETTLED_MARGIN_MS
  const queryWindow = {
    fromMs: args.fromMs,
    ...(args.slugPatterns !== undefined ? { slugPatterns: args.slugPatterns } : {}),
    ...(args.toMs !== undefined ? { toMs: args.toMs } : {}),
    settledBeforeMs,
    refetchNulls: args.refetchNulls,
  }

  const pending = await countMarketsForGammaBackfill(queryWindow)
  const target = args.limit !== undefined ? Math.min(pending, args.limit) : pending
  console.log(
    `[gamma-backfill] pending=${pending} target=${target} from=${new Date(args.fromMs).toISOString()} ` +
      (args.toMs !== undefined ? `to=${new Date(args.toMs).toISOString()} ` : '') +
      `settledBefore=${new Date(settledBeforeMs).toISOString()} batch=${args.batchSize}` +
      (args.refetchNulls ? ' REFETCH-NULLS' : '') +
      (args.dryRun ? ' DRY-RUN' : ''),
  )
  if (args.dryRun || target === 0) {
    await closeDb()
    return
  }

  let aborted = false
  installSignalHandlers({
    onSignal: (sig) => {
      console.warn(`[gamma-backfill] ${sig} — finishing current batch, then stopping`)
      aborted = true
    },
  })

  let processed = 0
  let withPrice = 0
  let withFinal = 0
  let gammaNull = 0
  let notFound = 0
  let nextLogAt = 1000
  const startedAt = Date.now()

  /** Parse + count + stamp one definitive Gamma answer (null raw = not on Gamma). */
  const applyResult = async (slug: string, raw: Record<string, unknown> | null): Promise<void> => {
    const md = raw ? parseGammaEventMetadata(raw) : { priceToBeat: null, finalPrice: null }
    if (!raw) notFound++
    else if (md.priceToBeat !== null) withPrice++
    else gammaNull++
    if (md.finalPrice !== null) withFinal++
    await updateGammaMetadata(slug, md)
    processed++
  }

  /** Process a claimed slice of rows in Gamma-batch-sized chunks. */
  const processRows = async (rows: Array<{ slug: string; marketStartMs: number }>) => {
    for (let i = 0; i < rows.length && !aborted; i += args.batchSize) {
      const batch = rows.slice(i, i + args.batchSize)
      const bySlug = await withGammaRetry(
        'batch',
        () => fetchClosedGammaMarketsBySlugs(batch.map((r) => r.slug)),
        () => aborted,
      )
      if (!bySlug) break

      for (const row of batch) {
        const raw = bySlug.get(row.slug)
        if (raw) {
          await applyResult(row.slug, raw)
        } else {
          // Not in the closed set — try the single-slug path (open + closed)
          // before concluding Gamma doesn't know the market at all. Same
          // spacing + backoff as the batch path.
          await sleep(REQUEST_SPACING_MS)
          const single = await withGammaRetry(
            `fallback ${row.slug}`,
            () => fetchGammaMarketBySlug({ slug: row.slug }),
            () => aborted,
          )
          if (aborted) break
          await applyResult(row.slug, single)
        }
      }

      if (processed >= nextLogAt) {
        nextLogAt = processed + 1000
        const rate = processed / ((Date.now() - startedAt) / 1000)
        const etaMin = (target - processed) / rate / 60
        console.log(
          `[gamma-backfill] ${processed}/${target} withPrice=${withPrice} gammaNull=${gammaNull} notFound=${notFound} (${rate.toFixed(1)} rows/s, eta ${etaMin.toFixed(0)}min)`,
        )
      }
      await sleep(REQUEST_SPACING_MS)
    }
  }

  if (args.refetchNulls) {
    // Refetch mode: rows whose strike is STILL null after re-fetching keep
    // matching the predicate, so an incremental claim loop would spin on the
    // same oldest rows forever — fetch the whole work list once instead.
    const rows = await listMarketsForGammaBackfill({ ...queryWindow, limit: target })
    await processRows(rows)
  } else {
    // Batched claim loop: stamped rows drop out of the pending query, so the
    // CLI is resumable at any point.
    while (!aborted && processed < target) {
      const rows = await listMarketsForGammaBackfill({
        ...queryWindow,
        limit: Math.min(500, target - processed),
      })
      if (rows.length === 0) break
      await processRows(rows)
    }
  }

  console.log(
    `[gamma-backfill] done: processed=${processed} withPrice=${withPrice} withFinalPrice=${withFinal} gammaNull=${gammaNull} notFound=${notFound}` +
      (aborted ? ' (aborted early — rerun to resume)' : ''),
  )
  await closeDb()
  if (aborted) process.exit(130)
}

main().catch((err) => {
  console.error('[gamma-backfill] fatal:', err)
  process.exit(1)
})
