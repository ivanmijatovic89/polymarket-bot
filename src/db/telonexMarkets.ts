import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from './index.js'
import { telonexMarkets, telonexMarketConversions } from './schema.js'

export type ReadFrom = 'local' | 'r2'
export type Converter = 'delta-typed' | 'paired'

export type Market = {
  marketId: string
  slug: string
  symbol: string
  dataset: string | null // local_path or r2_url, picked by caller via readFrom
  outcome0: string | null
  outcome1: string | null
  assetId0: string | null
  assetId1: string | null
  resultId: string | null
  telonexStatus: string | null
  question: string | null
  startDateMs: number | null // derived from start_date_us
  endDateMs: number | null // derived from end_date_us
}

function mustGetDb(): ReturnType<typeof getDb> {
  const db = getDb()
  if (!db) {
    throw new Error('[db] getDb() returned null (unexpected)')
  }
  return db
}

function extractSymbolFromSlug(slug: string): string {
  const dash = slug.indexOf('-')
  return dash > 0 ? slug.slice(0, dash) : slug
}

function pickDataset(
  readFrom: ReadFrom,
  row: { localPath: string | null; r2Url: string | null },
): string | null {
  return readFrom === 'local' ? row.localPath : row.r2Url
}

type JoinedRow = {
  marketId: number
  slug: string
  outcome0: string | null
  outcome1: string | null
  assetId0: string | null
  assetId1: string | null
  resultId: string | null
  telonexStatus: string | null
  question: string | null
  startDateUs: number | null
  endDateUs: number | null
  localPath: string | null
  r2Url: string | null
}

function usToMs(us: number | null): number | null {
  if (us === null || !Number.isFinite(us)) return null
  return Math.trunc(us / 1000)
}

function toMarket(row: JoinedRow, readFrom: ReadFrom): Market {
  return {
    marketId: String(row.marketId),
    slug: row.slug,
    symbol: extractSymbolFromSlug(row.slug),
    dataset: pickDataset(readFrom, row),
    outcome0: row.outcome0,
    outcome1: row.outcome1,
    assetId0: row.assetId0,
    assetId1: row.assetId1,
    resultId: row.resultId,
    telonexStatus: row.telonexStatus,
    question: row.question,
    startDateMs: usToMs(row.startDateUs),
    endDateMs: usToMs(row.endDateUs),
  }
}

function baseSelect() {
  const db = mustGetDb()
  return db
    .select({
      marketId: telonexMarkets.id,
      slug: telonexMarkets.slug,
      outcome0: telonexMarkets.outcome0,
      outcome1: telonexMarkets.outcome1,
      assetId0: telonexMarkets.assetId0,
      assetId1: telonexMarkets.assetId1,
      resultId: telonexMarkets.resultId,
      telonexStatus: telonexMarkets.telonexStatus,
      question: telonexMarkets.question,
      startDateUs: telonexMarkets.startDateUs,
      endDateUs: telonexMarkets.endDateUs,
      localPath: telonexMarketConversions.localPath,
      r2Url: telonexMarketConversions.r2Url,
    })
    .from(telonexMarkets)
    .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
}

export async function getMarketBySlug(
  slug: string,
  opts: { converter: Converter; readFrom: ReadFrom },
): Promise<Market | null> {
  const results = await baseSelect()
    .where(
      and(
        eq(telonexMarkets.slug, slug),
        eq(telonexMarketConversions.converter, opts.converter),
        eq(telonexMarketConversions.status, 'done'),
      ),
    )
    .limit(1)
  const row = results[0] as JoinedRow | undefined
  return row ? toMarket(row, opts.readFrom) : null
}

export async function getMarketsBySlugs(
  slugs: string[],
  opts: { converter: Converter; readFrom: ReadFrom },
): Promise<Market[]> {
  if (slugs.length === 0) return []
  const results = (await baseSelect().where(
    and(
      inArray(telonexMarkets.slug, slugs),
      eq(telonexMarketConversions.converter, opts.converter),
      eq(telonexMarketConversions.status, 'done'),
    ),
  )) as JoinedRow[]
  return results.map((r) => toMarket(r, opts.readFrom))
}

export async function getMarketsBySymbol(
  symbol: string,
  opts: {
    converter: Converter
    readFrom: ReadFrom
    timeframe: string
    limit?: number
    random?: boolean
    latest?: boolean
  },
): Promise<Market[]> {
  const lowerSymbol = symbol.toLowerCase()
  const slugPrefix = `${lowerSymbol}-updown-${opts.timeframe}-%`

  const where = and(
    sql`${telonexMarkets.slug} LIKE ${slugPrefix}`,
    eq(telonexMarketConversions.converter, opts.converter),
    eq(telonexMarketConversions.status, 'done'),
  )

  const orderBy = opts.random ? sql`RAND()` : asc(telonexMarkets.slug)

  let offset: number | undefined
  if (opts.latest && opts.limit !== undefined) {
    const db = mustGetDb()
    const countResult = await db
      .select({ count: count() })
      .from(telonexMarkets)
      .innerJoin(telonexMarketConversions, eq(telonexMarketConversions.marketId, telonexMarkets.id))
      .where(where)
    const total = countResult[0]?.count ?? 0
    offset = Math.max(0, total - opts.limit)
  }

  const queryBuilder = baseSelect()
    .where(where)
    .orderBy(orderBy)
    .limit(opts.limit ?? 1000)

  const results = (
    offset !== undefined ? await queryBuilder.offset(offset) : await queryBuilder
  ) as JoinedRow[]

  return results.map((r) => toMarket(r, opts.readFrom))
}
