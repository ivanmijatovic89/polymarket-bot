import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activityFetchStartSec,
  coverageRebaseStatuses,
  coverageRebaseTarget,
  dedupKey,
  FULL_HISTORY_CURSOR_MS,
  identityOf,
  needsWalletStatsRefresh,
  nextActivityCursorMs,
  selectActivityRows,
} from './activityRows.js'
import type { ApiActivity } from './activityApi.js'

const HOUR = 60 * 60 * 1000

test('cursor: a null cursor fetches all history from 1', () => {
  assert.equal(activityFetchStartSec(null, HOUR), 1)
})

test('cursor: fetch resumes one overlap before the stored cursor', () => {
  const cursorMs = Date.parse('2026-07-10T12:00:00Z')
  const startSec = activityFetchStartSec(cursorMs, HOUR)
  assert.equal(startSec, Math.floor((cursorMs - HOUR) / 1000))
})

test('cursor: start is clamped to 1 and never negative', () => {
  assert.equal(activityFetchStartSec(500, HOUR), 1) // cursor-overlap is negative
})

test('cursor advances to the scanned-through bound, not the newest event (inactive wallet)', () => {
  // Wallet's last activity was long ago; we scanned through "now". The next
  // cursor must be ~now so the next refresh does not re-read the whole tail.
  const oldEventMs = Date.parse('2026-02-01T00:00:00Z')
  const scannedThroughMs = Date.parse('2026-07-14T00:00:00Z')
  const next = nextActivityCursorMs(oldEventMs, scannedThroughMs)
  assert.equal(next, scannedThroughMs)
  // And the following fetch starts near the recent window, not in February.
  assert.ok(activityFetchStartSec(next, HOUR) * 1000 >= scannedThroughMs - HOUR)
})

test('cursor advances for a wallet with no activity at all', () => {
  const scannedThroughMs = Date.parse('2026-07-14T00:00:00Z')
  assert.equal(nextActivityCursorMs(null, scannedThroughMs), scannedThroughMs)
})

test('cursor never moves backward', () => {
  const prev = Date.parse('2026-07-14T00:00:00Z')
  const earlier = Date.parse('2026-07-01T00:00:00Z')
  assert.equal(nextActivityCursorMs(prev, earlier), prev)
})

test('incremental refresh with no new rows keeps advancing the cursor', () => {
  // First run scanned through T1; a later run with nothing new scans through T2.
  const t1 = Date.parse('2026-07-14T00:00:00Z')
  const t2 = t1 + 5 * 24 * HOUR
  const c1 = nextActivityCursorMs(null, t1)
  const c2 = nextActivityCursorMs(c1, t2)
  assert.equal(c2, t2)
  // The next fetch re-reads only the overlap window, so a row landing inside it
  // (just before t2) would still be within [start, ...] and thus discovered.
  const startSec = activityFetchStartSec(c2, HOUR)
  assert.ok(startSec * 1000 <= t2 - HOUR + 1000)
})

test('coverage rebase: a wallet synced before an older market was cataloged is rebased', () => {
  const HR = 60 * 60 * 1000
  const walletSynced = Date.parse('2026-07-01T00:00:00Z')
  const cursor = Date.parse('2026-07-14T00:00:00Z') // scanned through mid-July
  // An older market (June window) that was cataloged AFTER the wallet synced —
  // e.g. the floor was lowered on 2026-07-10. Its activity was filtered out
  // originally and now sits behind the cursor's refresh window.
  const oldMarketStart = Date.parse('2026-06-05T00:00:00Z')
  const target = coverageRebaseTarget(
    { activitySyncedMs: walletSynced, cursorTs: cursor },
    [{ syncedMs: Date.parse('2026-07-10T00:00:00Z'), marketStartMs: oldMarketStart }],
    HR,
  )
  assert.equal(target, FULL_HISTORY_CURSOR_MS, 'historical expansion forces a complete re-read')
  assert.equal(
    activityFetchStartSec(target, HR),
    1,
    'the next fetch includes activity from before the market window',
  )
})

test('coverage rebase: any affected historical market forces full history; others are ignored', () => {
  const HR = 60 * 60 * 1000
  const walletSynced = Date.parse('2026-07-01T00:00:00Z')
  const cursor = Date.parse('2026-07-14T00:00:00Z')
  const target = coverageRebaseTarget(
    { activitySyncedMs: walletSynced, cursorTs: cursor },
    [
      // cataloged before the wallet synced → already covered, ignore
      { syncedMs: Date.parse('2026-06-20T00:00:00Z'), marketStartMs: Date.parse('2026-06-01') },
      // two newly-cataloged older markets → earliest start wins
      { syncedMs: Date.parse('2026-07-11T00:00:00Z'), marketStartMs: Date.parse('2026-06-15') },
      { syncedMs: Date.parse('2026-07-11T00:00:00Z'), marketStartMs: Date.parse('2026-06-10') },
      // cataloged late but inside the refresh window (recent) → caught anyway, ignore
      {
        syncedMs: Date.parse('2026-07-13T00:00:00Z'),
        marketStartMs: Date.parse('2026-07-13T12:00:00Z'),
      },
    ],
    HR,
  )
  assert.equal(target, FULL_HISTORY_CURSOR_MS)
})

test('coverage rebase: stale/refresh requeues remain eligible without stealing live claims', () => {
  // --stale-after 0 and --refresh-done move a done wallet to pending. The SQL
  // rebase predicates are built from this same helper, so pending must
  // remain repairable while processing (owned by another worker) must not.
  const normal = coverageRebaseStatuses({
    includeFailed: false,
    includeProcessingPreview: false,
  })
  assert.ok(normal.includes('pending'))
  assert.ok(normal.includes('done'))
  assert.equal(normal.includes('failed'), false, 'failed stays opt-in')
  assert.equal(normal.includes('processing'), false, 'never steal a live claim')

  assert.ok(
    coverageRebaseStatuses({ includeFailed: true, includeProcessingPreview: false }).includes(
      'failed',
    ),
    '--retry-failed/named runs may repair failed wallets',
  )
  assert.ok(
    coverageRebaseStatuses({ includeFailed: false, includeProcessingPreview: true }).includes(
      'processing',
    ),
    '--reset-processing dry-run models the post-reset status',
  )
})

test('coverage rebase: no rebase when nothing new predates the refresh window', () => {
  const HR = 60 * 60 * 1000
  const walletSynced = Date.parse('2026-07-01T00:00:00Z')
  const cursor = Date.parse('2026-07-14T00:00:00Z')
  // Only a market cataloged before the wallet synced (already covered).
  assert.equal(
    coverageRebaseTarget(
      { activitySyncedMs: walletSynced, cursorTs: cursor },
      [{ syncedMs: Date.parse('2026-06-01T00:00:00Z'), marketStartMs: Date.parse('2026-05-01') }],
      HR,
    ),
    null,
  )
  // A never-synced wallet (null cursor) is handled by the normal full scan.
  assert.equal(coverageRebaseTarget({ activitySyncedMs: null, cursorTs: null }, [], HR), null)
})

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
  assert.equal(identityOf(act({ pseudonym: 'x' })), identityOf(act({ pseudonym: 'y' })))
  assert.notEqual(identityOf(act({ size: 1 })), identityOf(act({ size: 2 })))
})

test('identity distinguishes rows that differ only in a previously-omitted field', () => {
  // Sibling rows of one transaction differ only in asset / outcomeIndex / side;
  // aggregated rows can differ only in usdcSize. Each must be its OWN identity —
  // otherwise a genuinely different event collapses into the same occurrence
  // group and gets discarded on dedup (or skipped at a pagination boundary).
  const base = act()
  assert.notEqual(identityOf(base), identityOf(act({ outcomeIndex: 1 })))
  assert.notEqual(identityOf(act({ asset: '0xtokenA' })), identityOf(act({ asset: '0xtokenB' })))
  assert.notEqual(identityOf(act({ side: 'BUY' })), identityOf(act({ side: 'SELL' })))
  assert.notEqual(identityOf(act({ price: 0.4 })), identityOf(act({ price: 0.6 })))
  assert.notEqual(identityOf(act({ usdcSize: 4 })), identityOf(act({ usdcSize: 6 })))
})

test('sibling events differing only by outcome/asset are kept as distinct rows', () => {
  // Two legs of one SPLIT/MERGE: same wallet, tx, timestamp, size, usdcSize, but
  // different outcome token. They must NOT be treated as the same event.
  const legs = [
    act({ type: 'MERGE', outcomeIndex: 0, asset: '0xyes' }),
    act({ type: 'MERGE', outcomeIndex: 1, asset: '0xno' }),
  ]
  const kept = selectActivityRows(legs, INDEX, false)
  assert.equal(kept.length, 2)
  assert.notEqual(kept[0]!.key, kept[1]!.key, 'distinct events get distinct keys')

  // And on an incremental overlap re-read they keep the SAME keys (both are
  // occurrence 0 of their own identity), so ON DUPLICATE KEY no-ops instead of
  // discarding one leg and duplicating the other.
  const reread = selectActivityRows(legs, INDEX, false)
  assert.equal(reread[0]!.key, kept[0]!.key)
  assert.equal(reread[1]!.key, kept[1]!.key)
})

test('stats refresh runs before a --min-trades requeue even when nothing is pending', () => {
  // The bug: a done wallet below the stale threshold whose new trades pushed it
  // over. With no other wallet pending the old gate skipped the refresh, so the
  // requeue filtered on a stale count and the wallet stayed undiscovered.
  const base = { dryRun: false, namedRun: false, minTrades: 10, requeueRequested: true }
  assert.equal(needsWalletStatsRefresh(base, false), true, 'refresh despite empty pending set')

  // --min-trades alone (fresh claim, no requeue) still needs fresh counts.
  assert.equal(needsWalletStatsRefresh({ ...base, requeueRequested: false }, false), true)
  // A requeue without a threshold needs fresh counts for claim ordering.
  assert.equal(
    needsWalletStatsRefresh({ ...base, minTrades: 0, requeueRequested: true }, false),
    true,
  )
})

test('stats refresh is skipped only when it cannot matter', () => {
  const noWork = { dryRun: false, namedRun: false, minTrades: 0, requeueRequested: false }
  assert.equal(needsWalletStatsRefresh(noWork, false), false, 'plain drain, nothing pending')
  assert.equal(needsWalletStatsRefresh(noWork, true), true, 'plain drain, pending → order matters')
  // Dry-run must not write (refresh mutates), and named runs ignore counts.
  assert.equal(needsWalletStatsRefresh({ ...noWork, dryRun: true }, true), false)
  assert.equal(
    needsWalletStatsRefresh(
      { dryRun: false, namedRun: true, minTrades: 10, requeueRequested: true },
      true,
    ),
    false,
  )
})

test('dedupKey fits the column and is deterministic', () => {
  const k = dedupKey('a|b|c', 0)
  assert.equal(k.length, 40)
  assert.equal(k, dedupKey('a|b|c', 0))
  assert.notEqual(k, dedupKey('a|b|c', 1))
})
