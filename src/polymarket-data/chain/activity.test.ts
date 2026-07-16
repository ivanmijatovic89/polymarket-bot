import assert from 'node:assert/strict'
import test from 'node:test'
import type { Hex } from 'viem'
import { normalizeActivityEvent } from './activity.js'
import type { DecodedChainEvent } from './decode.js'
import type { TokenMarket } from './discovery.js'

const CONDITION = `0x${'11'.repeat(32)}` as Hex
const TX = `0x${'22'.repeat(32)}` as Hex
const WALLET = '0x3333333333333333333333333333333333333333'
const OTHER = '0x4444444444444444444444444444444444444444'
const TOKEN: TokenMarket = {
  marketId: 7,
  conditionId: CONDITION,
  tokenId: '123',
  outcomeIndex: 1,
}

function event(eventName: string, args: Record<string, unknown>): DecodedChainEvent {
  return {
    eventName,
    args,
    blockNumber: 10n,
    transactionHash: TX,
    transactionIndex: 2,
    logIndex: 3,
    contract: WALLET,
  }
}

const conditions = new Map([[CONDITION, { marketId: 7, conditionId: CONDITION }]])
const tokens = new Map([[TOKEN.tokenId, TOKEN]])

test('normalizes market split and redemption amounts exactly', () => {
  const split = normalizeActivityEvent(
    event('PositionSplit', { stakeholder: WALLET, conditionId: CONDITION, amount: 1_000_001n }),
    conditions,
    tokens,
  )
  assert.equal(split[0]?.type, 'SPLIT')
  assert.equal(split[0]?.amountAtomic, 1_000_001n)
  const redeem = normalizeActivityEvent(
    event('PayoutRedemption', { redeemer: WALLET, conditionId: CONDITION, payout: 500_000n }),
    conditions,
    tokens,
  )
  assert.equal(redeem[0]?.type, 'REDEEM')
  assert.equal(redeem[0]?.payoutAtomic, 500_000n)
})

test('expands only target tokens from ERC1155 batches', () => {
  const rows = normalizeActivityEvent(
    event('TransferBatch', {
      operator: WALLET,
      from: WALLET,
      to: OTHER,
      ids: [123n, 999n],
      values: [7n, 8n],
    }),
    conditions,
    tokens,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.tokenId, '123')
  assert.equal(rows[0]?.amountAtomic, 7n)
  assert.equal(rows[0]?.counterparty, OTHER)
})
