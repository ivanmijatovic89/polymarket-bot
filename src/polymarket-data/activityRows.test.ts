import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupKey, identityOf, selectActivityRows } from './activityRows.js'
import type { ApiActivity } from './activityApi.js'

const CID_OURS = '0xours'
const CID_OTHER = '0xother'
const INDEX = new Map([[CID_OURS, 42]])

function act(over: Partial<ApiActivity> = {}): ApiActivity {
  return {
    proxyWallet: '0xAAA',
    type: 'REDEEM',
    timestamp: 1_000_000,
    conditionId: CID_OURS,
    size: 10,
    usdcSize: 10,
    transactionHash: '0xtx',
    ...over,
  }
}

test('TRADE rows never enter the activity table', () => {
  const kept = selectActivityRows([act({ type: 'TRADE' }), act({ type: 'SPLIT' })], INDEX, false)
  assert.deepEqual(
    kept.map((k) => k.row.type),
    ['SPLIT'],
  )
})

test('rows on markets we do not track are dropped, unless --full', () => {
  const rows = [act(), act({ conditionId: CID_OTHER })]

  const ours = selectActivityRows(rows, INDEX, false)
  assert.equal(ours.length, 1)
  assert.equal(ours[0]!.marketId, 42)

  const all = selectActivityRows(rows, INDEX, true)
  assert.equal(all.length, 2)
  assert.equal(all[1]!.marketId, null, 'untracked market keeps a null market_id')
})

test('two genuinely identical events both survive', () => {
  // e.g. the same split twice inside one transaction — real, and must not be
  // collapsed into one row.
  const kept = selectActivityRows([act({ type: 'SPLIT' }), act({ type: 'SPLIT' })], INDEX, false)
  assert.equal(kept.length, 2)
  assert.notEqual(kept[0]!.key, kept[1]!.key)
})

test('keys are stable when the cursor shifts the fetch window', () => {
  // THE regression that doubled the table: keying on a row's position in the
  // fetched page. A warm cursor starts mid-history, so every row shifts up — the
  // keys must not move with it.
  const history = [
    act({ timestamp: 100, transactionHash: '0xa' }),
    act({ timestamp: 200, transactionHash: '0xb' }),
    act({ timestamp: 300, transactionHash: '0xc' }),
  ]

  const coldRun = selectActivityRows(history, INDEX, false)
  // A later run resumes from the cursor and only sees the tail.
  const warmRun = selectActivityRows(history.slice(2), INDEX, false)

  assert.equal(warmRun[0]!.key, coldRun[2]!.key, 'same row must keep the same key')
})

test('keys stay stable when a TRADE row is interleaved', () => {
  // The occurrence counter runs over non-trade rows only, so a trade appearing
  // (or not) in the page must not shift anyone's key.
  const withTrade = selectActivityRows(
    [act({ type: 'TRADE' }), act({ type: 'MERGE' })],
    INDEX,
    false,
  )
  const withoutTrade = selectActivityRows([act({ type: 'MERGE' })], INDEX, false)

  assert.equal(withTrade[0]!.key, withoutTrade[0]!.key)
})

test('a row key does not depend on which markets are in the catalog', () => {
  // Occurrence is counted before the market filter, so syncing a wallet before
  // and after the catalog grows must not remint its keys.
  const rows = [act({ conditionId: CID_OTHER }), act({ transactionHash: '0xz' })]

  const narrow = selectActivityRows(rows, INDEX, false)
  const wide = selectActivityRows(rows, new Map([...INDEX, [CID_OTHER, 7]]), false)

  const shared = wide.find((k) => k.row.transactionHash === '0xz')!
  assert.equal(shared.key, narrow[0]!.key)
})

test('identity ignores fields that are not part of the event', () => {
  assert.equal(identityOf(act({ name: 'x' })), identityOf(act({ name: 'y' })))
  assert.notEqual(identityOf(act({ size: 1 })), identityOf(act({ size: 2 })))
})

test('dedupKey fits the column and is deterministic', () => {
  const k = dedupKey('a|b|c', 0)
  assert.equal(k.length, 40)
  assert.equal(k, dedupKey('a|b|c', 0))
  assert.notEqual(k, dedupKey('a|b|c', 1))
})
