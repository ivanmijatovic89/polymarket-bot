import assert from 'node:assert/strict'
import test from 'node:test'
import { and } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { telonexDatasetMaxStartMs } from '../config/telonex.js'
import { telonexMarketConversions, telonexMarkets } from './schema.js'
import { buildTelonexEligibilityConditions } from './telonexEligibility.js'

const columns = {
  markets: {
    slug: telonexMarkets.slug,
    symbol: telonexMarkets.symbol,
    timeframe: telonexMarkets.timeframe,
    marketStartMs: telonexMarkets.marketStartMs,
    telonexStatus: telonexMarkets.telonexStatus,
    resultId: telonexMarkets.resultId,
  },
  conversions: {
    converter: telonexMarketConversions.converter,
    status: telonexMarketConversions.status,
    localPath: telonexMarketConversions.localPath,
    r2Url: telonexMarketConversions.r2Url,
  },
}

function eligibilityParams(toMs?: number): unknown[] {
  const where = and(
    ...buildTelonexEligibilityConditions(columns, {
      converter: 'delta-typed',
      readFrom: 'local',
      fromMs: 1,
      ...(toMs !== undefined ? { toMs } : {}),
    }),
  )
  assert.ok(where)
  return new MySqlDialect().sqlToQuery(where).params
}

test('shared eligibility always applies the publication-lag ceiling', () => {
  const before = telonexDatasetMaxStartMs()
  const params = eligibilityParams()
  const after = telonexDatasetMaxStartMs()
  const numeric = params.filter((value): value is number => typeof value === 'number')

  assert.equal(numeric[0], 1, 'the configured lower bound should remain first')
  assert.ok(numeric[1] !== undefined && numeric[1] >= before && numeric[1] <= after)
})

test('an explicit eligibility upper bound can only narrow the publication ceiling', () => {
  const requestedToMs = Number.MIN_SAFE_INTEGER
  const params = eligibilityParams(requestedToMs)
  const numeric = params.filter((value): value is number => typeof value === 'number')

  assert.deepEqual(numeric, [1, requestedToMs])
})
