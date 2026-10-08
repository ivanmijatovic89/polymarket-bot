import { and, eq, gte, lte, inArray, notInArray, sql } from 'drizzle-orm'
import { canonicalJson } from '../recorder-v4/replay/provenance.js'
import { getDb } from './index.js'
import { recorderV4Recordings as recordings, recorderV4CatalogSyncs as syncs } from './schema.js'
import { CatalogReadinessError } from '../recorder-v4/catalog/errors.js'
import { catalogScopeId, validateCatalogRecording } from '../recorder-v4/catalog/identity.js'
import type {
  CatalogRecording,
  CatalogRepository,
  CatalogScope,
  CatalogSyncStatus,
} from '../recorder-v4/catalog/types.js'
import { captureMarketResolution } from '../recorder-v4/replay/package.js'
import type { CaptureSelectionFilters } from '../recorder-v4/replay/selection.js'

export const CATALOG_MAX_AGE_MS = 15 * 60_000

export function catalogRow(recording: CatalogRecording): typeof recordings.$inferInsert {
  const r = validateCatalogRecording(recording)
  const { market, coverage, events } = r.manifest
  const complete = (feed: string) => !coverage.gaps.some((gap) => gap.feed === feed)
  return {
    ...r,
    recordingId: r.manifest.recordingId,
    slug: market.slug,
    symbol: market.symbol,
    timeframe: market.timeframe,
    startMs: market.startMs,
    endMs: market.endMs,
    eventsKey: events.key,
    eventsSha256: events.sha256,
    eventsBytes: events.bytes,
    eventsRows: events.rows,
    complete: coverage.complete,
    missingInitialBook: coverage.missingInitialBook,
    polymarketComplete: complete('polymarket') && !coverage.missingInitialBook,
    binanceAggTradeComplete: complete('binance_agg_trade'),
    binanceBookTickerComplete: complete('binance_book_ticker'),
    chainlinkSpotComplete: complete('chainlink_spot'),
    chainlinkTwapComplete: complete('chainlink_twap'),
    websitePtbComplete: complete('price_to_beat'),
    websitePtbObserved: r.referenceEvidence.websiteObserved,
    openingTwapAvailable: r.referenceEvidence.openingReasons.length === 0,
    outcome: captureMarketResolution(r.manifest, r.latestResolution ? [r.latestResolution] : [])
      .outcome,
    resolutionObservedAtMs: r.latestResolution?.observedAtMs ?? null,
  }
}

/** Two concurrent importers cannot replace an immutable recording or regress its resolution. */
export function mergeCatalogRecording(
  previous: CatalogRecording,
  incoming: CatalogRecording,
): CatalogRecording {
  if (
    previous.id !== incoming.id ||
    previous.bucket !== incoming.bucket ||
    previous.prefix !== incoming.prefix ||
    previous.manifestKey !== incoming.manifestKey ||
    previous.manifestSha256 !== incoming.manifestSha256 ||
    canonicalJson(previous.referenceEvidence) !== canonicalJson(incoming.referenceEvidence)
  )
    throw new Error('Immutable catalog recording conflicts with an existing row')
  const oldTime = previous.latestResolution?.observedAtMs ?? 0
  const newTime = incoming.latestResolution?.observedAtMs ?? 0
  if (newTime < oldTime) return previous
  if (
    oldTime === newTime &&
    canonicalJson(previous.latestResolution) !== canonicalJson(incoming.latestResolution)
  )
    throw new Error('Conflicting resolution observations at the same timestamp')
  return { ...incoming, verifiedAtMs: previous.verifiedAtMs }
}

export class MysqlRecorderCatalog implements CatalogRepository {
  async listKnown(scope: CatalogScope, fromMs?: number) {
    return getDb()
      .select({
        id: recordings.id,
        manifestKey: recordings.manifestKey,
        resolutionKeysSha256: recordings.resolutionKeysSha256,
      })
      .from(recordings)
      .where(
        and(
          eq(recordings.bucket, scope.bucket),
          eq(recordings.prefix, scope.prefix),
          fromMs === undefined ? undefined : gte(recordings.startMs, fromMs),
        ),
      )
  }
  async get(id: string) {
    const [row] = await getDb().select().from(recordings).where(eq(recordings.id, id)).limit(1)
    return row ? validateCatalogRecording(row) : null
  }
  async put(recording: CatalogRecording): Promise<void> {
    const incoming = validateCatalogRecording(recording)
    await getDb().transaction(async (tx) => {
      await tx
        .insert(recordings)
        .values(catalogRow(incoming))
        .onDuplicateKeyUpdate({ set: { id: sql`${recordings.id}` } })
      const [stored] = await tx
        .select()
        .from(recordings)
        .where(eq(recordings.id, incoming.id))
        .for('update')
      if (!stored) throw new Error('Catalog row disappeared during import')
      const merged = mergeCatalogRecording(validateCatalogRecording(stored), incoming)
      await tx.update(recordings).set(catalogRow(merged)).where(eq(recordings.id, incoming.id))
    })
  }
  async saveStatus(status: CatalogSyncStatus): Promise<void> {
    const finished =
      status.finishedAtMs !== null && status.remaining === 0 && status.failures.length === 0
    const initializedAtMs = finished && status.fullScan ? status.finishedAtMs : null
    const lastCompletedAtMs = finished ? status.finishedAtMs : null
    await getDb()
      .insert(syncs)
      .values({
        id: catalogScopeId(status),
        bucket: status.bucket,
        prefix: status.prefix,
        status,
        initializedAtMs,
        lastCompletedAtMs,
      })
      .onDuplicateKeyUpdate({
        set: {
          status,
          initializedAtMs: sql`COALESCE(${syncs.initializedAtMs}, ${initializedAtMs})`,
          lastCompletedAtMs: sql`COALESCE(${lastCompletedAtMs}, ${syncs.lastCompletedAtMs})`,
        },
      })
  }
}

export async function readCatalogStatus(scope: CatalogScope) {
  const [row] = await getDb()
    .select()
    .from(syncs)
    .where(eq(syncs.id, catalogScopeId(scope)))
    .limit(1)
  return row ?? null
}

export async function queryCatalogRecordings(
  scope: CatalogScope,
  filters: CaptureSelectionFilters = {},
): Promise<CatalogRecording[]> {
  const status = await readCatalogStatus(scope)
  if (!status?.initializedAtMs)
    throw new CatalogReadinessError(
      'Recorder V4 MySQL catalog is not initialized. Run npm run record:v4:catalog -- sync with the catalog service configuration.',
    )
  if (!status.lastCompletedAtMs || Date.now() - status.lastCompletedAtMs > CATALOG_MAX_AGE_MS)
    throw new CatalogReadinessError(
      'Recorder V4 MySQL catalog is stale (over 15 minutes). Restore its sync service before selecting markets.',
    )
  const rows = await getDb()
    .select()
    .from(recordings)
    .where(
      and(
        eq(recordings.bucket, scope.bucket),
        eq(recordings.prefix, scope.prefix),
        filters.timeframe ? eq(recordings.timeframe, filters.timeframe) : undefined,
        filters.fromMs === undefined ? undefined : gte(recordings.startMs, filters.fromMs),
        filters.toMs === undefined ? undefined : lte(recordings.startMs, filters.toMs),
        filters.slugs?.length ? inArray(recordings.slug, [...filters.slugs]) : undefined,
        filters.excludeSlugs?.length
          ? notInArray(recordings.slug, [...filters.excludeSlugs])
          : undefined,
      ),
    )
    .orderBy(recordings.startMs, recordings.id)
  return rows.map((row) => {
    const recording = validateCatalogRecording(row)
    if (recording.bucket !== scope.bucket || recording.prefix !== scope.prefix)
      throw new Error('Catalog scope does not match the requested archive')
    return recording
  })
}
