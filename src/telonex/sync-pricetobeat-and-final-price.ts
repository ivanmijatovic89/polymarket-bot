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
  fromMs: number
  toMs?: number
  limit?: number
  batchSize: number
  dryRun: boolean
}

function parseDateMs(raw: string, flag: string): number {
  const ms = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)
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
  let toMs: number | undefined
  let limit: number | undefined
  let batchSize = 20
  let dryRun = false
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
    else if (a === '--dry-run') dryRun = true
    else {
      console.error(
        'Usage: npm run telonex:sync-pricetobeat-and-final-price -- ' +
          '[--from <iso|ms>] [--to <iso|ms>] [--limit N] [--batch-size 20] [--dry-run]',
      )
      process.exit(2)
    }
  }
  return {
    fromMs,
    ...(toMs !== undefined ? { toMs } : {}),
    ...(limit ? { limit } : {}),
    batchSize,
    dryRun,
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
    ...(args.toMs !== undefined ? { toMs: args.toMs } : {}),
    settledBeforeMs,
  }

  const pending = await countMarketsForGammaBackfill(queryWindow)
  const target = args.limit !== undefined ? Math.min(pending, args.limit) : pending
  console.log(
    `[gamma-backfill] pending=${pending} target=${target} from=${new Date(args.fromMs).toISOString()} ` +
      (args.toMs !== undefined ? `to=${new Date(args.toMs).toISOString()} ` : '') +
      `settledBefore=${new Date(settledBeforeMs).toISOString()} batch=${args.batchSize}` +
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

  // Batched claim loop: stamped rows drop out of the pending query, so the
  // CLI is resumable at any point.
  while (!aborted && processed < target) {
    const rows = await listMarketsForGammaBackfill({
      ...queryWindow,
      limit: Math.min(500, target - processed),
    })
    if (rows.length === 0) break

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
