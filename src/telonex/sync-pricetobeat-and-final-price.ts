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
    else if (a === '--limit') limit = Math.max(1, Number(next()) || 0)
    else if (a === '--batch-size') batchSize = Math.min(50, Math.max(1, Number(next()) || 20))
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

async function fetchBatchWithRetry(
  slugs: string[],
  isAborted: () => boolean,
): Promise<Map<string, Record<string, unknown>> | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchClosedGammaMarketsBySlugs(slugs)
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length) throw err
      const delay = RETRY_DELAYS_MS[attempt]!
      console.warn(
        `[gamma-backfill] batch failed (${err instanceof Error ? err.message.slice(0, 120) : err}) — backing off ${delay / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
      )
      await sleep(delay)
      if (isAborted()) return null
    }
  }
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'gamma-backfill' })
  const args = parseArgs(process.argv.slice(2))

  // Clamp the upper bound so still-open windows are never queried against
  // closed=true (their absence there would be misread as "not on Gamma").
  const settledCutoff = Date.now() - SETTLED_MARGIN_MS
  const effectiveToMs = Math.min(args.toMs ?? Number.MAX_SAFE_INTEGER, settledCutoff)

  const pending = await countMarketsForGammaBackfill({ fromMs: args.fromMs, toMs: effectiveToMs })
  const target = args.limit !== undefined ? Math.min(pending, args.limit) : pending
  console.log(
    `[gamma-backfill] pending=${pending} target=${target} from=${new Date(args.fromMs).toISOString()} ` +
      `to=${new Date(effectiveToMs).toISOString()} batch=${args.batchSize}` +
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
  const startedAt = Date.now()

  // Batched claim loop: stamped rows drop out of the pending query, so the
  // CLI is resumable at any point.
  while (!aborted && processed < target) {
    const rows = await listMarketsForGammaBackfill({
      fromMs: args.fromMs,
      toMs: effectiveToMs,
      limit: Math.min(500, target - processed),
    })
    if (rows.length === 0) break

    for (let i = 0; i < rows.length && !aborted; i += args.batchSize) {
      const batch = rows.slice(i, i + args.batchSize)
      const bySlug = await fetchBatchWithRetry(
        batch.map((r) => r.slug),
        () => aborted,
      )
      if (!bySlug) break

      for (const row of batch) {
        const raw = bySlug.get(row.slug)
        if (raw) {
          const md = parseGammaEventMetadata(raw)
          if (md.priceToBeat !== null) withPrice++
          else gammaNull++
          if (md.finalPrice !== null) withFinal++
          await updateGammaMetadata(row.slug, md)
        } else {
          // Not in the closed set — try the single-slug path (open + closed)
          // before concluding Gamma doesn't know the market at all.
          const single = await fetchGammaMarketBySlug({ slug: row.slug })
          if (single) {
            const md = parseGammaEventMetadata(single)
            if (md.priceToBeat !== null) withPrice++
            else gammaNull++
            if (md.finalPrice !== null) withFinal++
            await updateGammaMetadata(row.slug, md)
          } else {
            notFound++
            await updateGammaMetadata(row.slug, { priceToBeat: null, finalPrice: null })
          }
        }
        processed++
      }

      if (processed % 1000 < args.batchSize) {
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
