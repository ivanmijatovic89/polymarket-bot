import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRecorderMarket } from './markets.js'
import { parseResolutionObservation } from './resolutionParser.js'

const raw = {
  slug: 'btc-updown-5m-1800',
  conditionId: 'condition',
  endDate: '1970-01-01T00:35:00.000Z',
  clobTokenIds: '["up-token","down-token"]',
  outcomes: '["Up","Down"]',
  cryptoMarketConfig: { twapEnabled: true, twapLookbackSeconds: 60 },
  closed: true,
  active: true,
  umaResolutionStatus: 'resolved',
  outcomePrices: '["0","1"]',
  events: [
    {
      eventMetadata: { priceToBeat: '85000.000000000000001', finalPrice: '84999.100000000000009' },
    },
  ],
}
const market = parseRecorderMarket(raw)

test('resolution requires explicit finality and preserves winner, payout, raw response and decimal metadata', () => {
  const rawJson = JSON.stringify(raw)
  const result = parseResolutionObservation(market, rawJson, 123)
  assert.equal(result.status, 'resolved')
  assert.equal(result.winningOutcome, 'Down')
  assert.equal(result.winningTokenId, 'down-token')
  assert.deepEqual(result.payouts, { 'up-token': '0', 'down-token': '1' })
  assert.equal(result.priceToBeat, '85000.000000000000001')
  assert.equal(result.finalPrice, '84999.100000000000009')
  assert.equal(result.observedAtMs, 123)
  assert.equal(result.rawJson, rawJson)
})

test('a price at one, closure alone, or a disputed proposal must never become an official winner', () => {
  for (const lifecycle of ['', 'proposed', 'disputed', 'challenged']) {
    const result = parseResolutionObservation(
      market,
      JSON.stringify({ ...raw, umaResolutionStatus: lifecycle }),
      123,
    )
    assert.notEqual(result.status, 'resolved')
    assert.equal(result.winningTokenId, null)
    assert.equal(result.payouts, null)
  }
})

test('resolved split payout preserves settlement without inventing a winning outcome', () => {
  const result = parseResolutionObservation(
    market,
    JSON.stringify({ ...raw, outcomePrices: '["0.5","0.5"]' }),
    123,
  )
  assert.equal(result.status, 'resolved')
  assert.equal(result.winningTokenId, null)
  assert.deepEqual(result.payouts, { 'up-token': '0.5', 'down-token': '0.5' })
})

test('invalid final payout, changed token mapping, nonclosed state and wrong condition fail closed', () => {
  for (const updates of [
    { outcomePrices: '["0.9","0.1","0"]' },
    { outcomePrices: '["1","1"]' },
    { clobTokenIds: '["other","down-token"]' },
    { outcomes: '["Down","Up"]' },
    { closed: false },
  ]) {
    assert.equal(
      parseResolutionObservation(market, JSON.stringify({ ...raw, ...updates }), 1).status,
      'unknown',
    )
  }
  assert.throws(
    () => parseResolutionObservation(market, JSON.stringify({ ...raw, conditionId: 'other' }), 1),
    /identity mismatch/,
  )
})
