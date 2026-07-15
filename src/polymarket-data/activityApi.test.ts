import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { fetchActivity, type ApiActivity } from './activityApi.js'
import { RateLimiter } from './rateLimiter.js'

const limiter = new RateLimiter(1000)

function row(ts: number, tx: string): ApiActivity {
  return {
    proxyWallet: '0xa',
    type: 'REDEEM',
    timestamp: ts,
    conditionId: '0xc',
    size: 1,
    usdcSize: 1,
    transactionHash: tx,
  }
}

/**
 * Serve `rows` the way the real API does: ascending by timestamp, filtered by
 * `start`, paged by `offset` — and rejecting offsets past the (real) 3000 cap,
 * which is what forces the window walk.
 */
function stubApi(rows: ApiActivity[], pageLimit = 500, maxOffset = 3000) {
  const calls: Array<{ start: number; offset: number }> = []

  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input))
    const start = Number(url.searchParams.get('start'))
    const offset = Number(url.searchParams.get('offset'))
    calls.push({ start, offset })

    if (offset > maxOffset) {
      return new Response(
        JSON.stringify({ error: 'max historical activity offset of 3000 exceeded' }),
        {
          status: 400,
        },
      )
    }

    const window = rows
      .filter((r) => r.timestamp >= start)
      .sort((a, b) => a.timestamp - b.timestamp)
    return new Response(JSON.stringify(window.slice(offset, offset + pageLimit)), { status: 200 })
  })

  return calls
}

test('same-second cluster exceeding the offset cap fails loudly (no infinite loop)', async (t) => {
  // >3500 rows (MAX_OFFSET 3000 + PAGE_LIMIT 500) all in ONE second: the window
  // cannot advance past that second, so the old code looped forever re-reading
  // the same capped pages. It must now throw a clear diagnostic instead.
  const rows = Array.from({ length: 4000 }, (_, i) => row(5000, `0x${i}`))
  stubApi(rows, 500, 3000)
  t.after(() => mock.restoreAll())

  await assert.rejects(fetchActivity({ wallet: '0xa' }, { limiter }), /cannot advance past 5000s/)
})

test('pages a wallet that fits inside one window', async (t) => {
  const rows = [row(10, '0x1'), row(20, '0x2')]
  stubApi(rows)
  t.after(() => mock.restoreAll())

  const out = await fetchActivity({ wallet: '0xa' }, { limiter })

  assert.equal(out.length, 2)
  assert.deepEqual(
    out.map((r) => r.transactionHash),
    ['0x1', '0x2'],
  )
})

test('walks the start window past the offset cap without losing or duplicating rows', async (t) => {
  // 4200 rows > the 3500 reachable in one window (offset<=3000 + limit 500), so
  // the walk MUST kick in. Each row is distinct, so any drop or duplicate shows.
  const rows = Array.from({ length: 4200 }, (_, i) => row(1000 + i, `0x${i}`))
  const calls = stubApi(rows, 500, 3000)
  t.after(() => mock.restoreAll())

  const out = await fetchActivity({ wallet: '0xa' }, { limiter })

  assert.equal(out.length, 4200, 'every row is returned exactly once')
  assert.deepEqual(
    out.map((r) => r.transactionHash),
    rows.map((r) => r.transactionHash),
    'order preserved, nothing dropped or duplicated',
  )
  assert.ok(
    calls.some((c) => c.start > 1 && c.offset === 0),
    'the window was advanced rather than the offset pushed past the cap',
  )
})

test('rows sharing the boundary second are kept exactly once', async (t) => {
  // The window re-enters AT the last timestamp (not after it), so rows in that
  // same second are re-read. They must be de-duplicated on the way back in — but
  // only the ones we already have: identical events are real and must survive.
  const rows: ApiActivity[] = []
  for (let i = 0; i < 3400; i++) rows.push(row(1000 + i, `0x${i}`))
  // A cluster of rows all sharing one second, straddling the window boundary.
  for (let i = 0; i < 300; i++) rows.push(row(9999, `0xdup${i}`))

  stubApi(rows, 500, 3000)
  t.after(() => mock.restoreAll())

  const out = await fetchActivity({ wallet: '0xa' }, { limiter })

  assert.equal(out.length, rows.length)
  const hashes = out.map((r) => r.transactionHash)
  assert.equal(new Set(hashes).size, hashes.length, 'no row is returned twice')
})

test('boundary rows differing only in an omitted field survive a reordered re-read', async (t) => {
  // The pagination boundary carry-over used to key on a subset of fields, so
  // same-second sibling rows (one transaction's legs differ only in
  // outcomeIndex) collapsed into ONE key. `/activity` sorts by timestamp only,
  // so their sub-second order is unspecified and can change between reads — then
  // the counter skips the wrong rows: one distinct leg is dropped and another
  // duplicated. The canonical identity keys each leg individually, so exactly the
  // already-seen ones are skipped regardless of order.
  const rows: ApiActivity[] = []
  for (let i = 0; i < 3400; i++) rows.push(row(1000 + i, `0x${i}`)) // distinct filler
  // A boundary-second cluster: identical but for outcomeIndex (same tx/size/…).
  for (let i = 0; i < 400; i++) {
    rows.push({
      proxyWallet: '0xa',
      type: 'REDEEM',
      timestamp: 9999,
      conditionId: '0xc',
      size: 1,
      usdcSize: 1,
      transactionHash: '0xdup',
      outcomeIndex: i,
    })
  }

  const calls: Array<{ start: number; offset: number }> = []
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input))
    const start = Number(url.searchParams.get('start'))
    const offset = Number(url.searchParams.get('offset'))
    calls.push({ start, offset })
    if (offset > 3000) {
      return new Response(JSON.stringify({ error: 'max historical activity offset of 3000' }), {
        status: 400,
      })
    }
    let window = rows.filter((r) => r.timestamp >= start).sort((a, b) => a.timestamp - b.timestamp)
    // Model the unspecified sub-second order: on the post-advance re-read (which
    // starts AT the boundary second) return the same-second rows reversed.
    if (start > 1) window = [...window].reverse()
    return new Response(JSON.stringify(window.slice(offset, offset + 500)), { status: 200 })
  })
  t.after(() => mock.restoreAll())

  const out = await fetchActivity({ wallet: '0xa' }, { limiter })

  assert.equal(out.length, 3800, 'no row lost or duplicated overall')
  const ids = out.map((r) => `${r.transactionHash}|${r.outcomeIndex ?? ''}`)
  assert.equal(new Set(ids).size, 3800, 'every distinct event appears exactly once')
  const legs = new Set(out.filter((r) => r.transactionHash === '0xdup').map((r) => r.outcomeIndex))
  assert.equal(legs.size, 400, 'all boundary-second legs are present')
  assert.ok(
    calls.some((c) => c.start > 1 && c.offset === 0),
    'the window actually advanced (the re-read path was exercised)',
  )
})

test('start=0 is coerced to 1 (0 means the API default window, not all history)', async (t) => {
  const calls = stubApi([row(5, '0x1')])
  t.after(() => mock.restoreAll())

  await fetchActivity({ wallet: '0xa', startSec: 0 }, { limiter })

  assert.equal(calls[0]!.start, 1)
})
