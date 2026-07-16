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
 * A fake transaction that counts the statements executed on it, and can be told
 * to throw on the Nth — modelling a crash at a specific step. Everything writes
 * through THIS object, so if a write happened outside it, the count would not add
 * up.
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

test('positions, wallets and the done-mark all run on ONE transaction', async () => {
  const tx = fakeTx()
  await writePositionsTx(tx, 1, [
    pos({ proxyWallet: '0xA', asset: '0xy' }),
    pos({ proxyWallet: '0xB', asset: '0xn' }),
  ])
  // DELETE + positions INSERT + wallets INSERT + done UPDATE = 4 statements, all
  // on the same tx. The old code did 3 here and upserted wallets on a SEPARATE
  // connection AFTER commit — exactly the split a crash could tear apart.
  assert.equal(tx.calls.length, 4)
})

test('a crash at the done-mark keeps wallets in the same uncommitted unit', async () => {
  // The done UPDATE is the last statement. Throwing there means the wallet insert
  // issued just before it is part of the same transaction, so a real DB rolls
  // both back together — never "positions done but wallets missing".
  const tx = fakeTx(4) // throw on the 4th statement = the done UPDATE
  await assert.rejects(writePositionsTx(tx, 1, [pos()]), /boom at call 4/)
  assert.equal(
    tx.calls.length,
    4,
    'the wallet insert (call 3) was issued on the tx before the failing done-mark',
  )
})

test('a market with no participants still writes atomically (delete + done)', async () => {
  const tx = fakeTx()
  await writePositionsTx(tx, 1, [])
  // DELETE + done UPDATE; no positions/wallets inserts when there are no rows.
  assert.equal(tx.calls.length, 2)
})
