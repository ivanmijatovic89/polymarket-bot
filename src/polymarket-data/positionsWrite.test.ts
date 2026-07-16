import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupePositions, writePositionsTx } from './positionsWrite.js'
import type { ApiPosition } from './dataApi.js'

function pos(over: Partial<ApiPosition> = {}): ApiPosition {
  return {
    proxyWallet: '0xAbc',
    asset: '0xtoken',
    conditionId: '0xcond',
    outcomeIndex: 0,
    size: 10,
    avgPrice: 0.5,
    totalBought: 5,
    realizedPnl: 1,
    cashPnl: 1,
    ...over,
  }
}

/**
 * A fake transaction that counts the small MySQL bookkeeping statements. The
 * position facts themselves have already been atomically published to Parquet.
 */
function fakeTx(throwOnCall?: number) {
  const calls: number[] = []
  return {
    calls,
    execute: async (): Promise<unknown> => {
      calls.push(1)
      if (throwOnCall !== undefined && calls.length === throwOnCall) {
        throw new Error(`boom at call ${throwOnCall}`)
      }
      return []
    },
  }
}

test('dedupePositions keeps one row per (wallet, asset)', () => {
  const rows = dedupePositions([
    pos({ proxyWallet: '0xA', asset: '0xy' }),
    pos({ proxyWallet: '0xA', asset: '0xy' }), // duplicate pair — collapsed
    pos({ proxyWallet: '0xA', asset: '0xn' }), // same wallet, other outcome — kept
    pos({ proxyWallet: '0xB', asset: '0xy' }),
  ])
  assert.equal(rows.length, 3)
})

test('wallet registration and the done-mark run on one transaction', async () => {
  const tx = fakeTx()
  await writePositionsTx(tx, 1, [
    pos({ proxyWallet: '0xA', asset: '0xy' }),
    pos({ proxyWallet: '0xB', asset: '0xn' }),
  ])
  // Wallets INSERT + done UPDATE. Position facts are not duplicated in MySQL.
  assert.equal(tx.calls.length, 2)
})

test('a crash at the done-mark keeps wallets in the same uncommitted unit', async () => {
  // The done UPDATE is the last statement. Throwing there means the wallet insert
  // issued just before it is part of the same transaction, so a real DB rolls
  // both back together — never "positions done but wallets missing".
  const tx = fakeTx(2) // throw on the 2nd statement = the done UPDATE
  await assert.rejects(writePositionsTx(tx, 1, [pos()]), /boom at call 2/)
  assert.equal(
    tx.calls.length,
    2,
    'the wallet insert was issued on the tx before the failing done-mark',
  )
})

test('a market with no participants only records the done state', async () => {
  const tx = fakeTx()
  await writePositionsTx(tx, 1, [])
  assert.equal(tx.calls.length, 1)
})
