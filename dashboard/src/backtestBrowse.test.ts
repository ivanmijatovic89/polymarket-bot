import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backtestBrowseParams,
  backtestPageBounds,
  backtestPageNumbers,
  changeBacktestFilter,
  readBacktestBrowseState,
} from './lib/backtestBrowse.js'

test('bookmark round trips preserve filters, ordering, page size and snapshot', () => {
  const state = readBacktestBrowseState(
    new URLSearchParams({
      protocol: 'research & experiments',
      model: 'model/a+b',
      strategy: 'example.v10',
      symbol: 'btc',
      status: 'partial',
      sort: 'ev-total-asc',
      limit: '25',
      page: '8',
      snapshot: '9000',
    }),
  )
  assert.deepEqual(readBacktestBrowseState(backtestBrowseParams(state)), state)
  assert.equal(backtestBrowseParams(readBacktestBrowseState(new URLSearchParams())).toString(), '')
})

test('malformed URL controls cannot produce unsafe offsets or arbitrary SQL ordering', () => {
  for (const invalid of ['', '-1', '0', '1.5', 'Infinity', 'NaN', '9007199254740992']) {
    const state = readBacktestBrowseState(
      new URLSearchParams({
        page: invalid,
        limit: invalid,
        sort: 'pnl; drop table',
        status: 'running',
      }),
    )
    assert.equal(state.page, 1)
    assert.equal(state.limit, 100)
    assert.equal(state.sort, 'newest')
    assert.equal(state.status, '')
  }
  assert.equal(readBacktestBrowseState(new URLSearchParams('limit=9999')).limit, 500)
  assert.equal(readBacktestBrowseState(new URLSearchParams(), 50).limit, 50)
  for (const invalid of ['', ' ', '-1', 'Infinity', '1.5']) {
    assert.equal(
      readBacktestBrowseState(new URLSearchParams({ snapshot: invalid })).snapshot,
      undefined,
    )
  }
  assert.equal(readBacktestBrowseState(new URLSearchParams('snapshot=0')).snapshot, 0)
})

test('switching protocol or model removes stale dependent selections and resets pagination', () => {
  const original = readBacktestBrowseState(
    new URLSearchParams(
      'protocol=p1&model=m1&strategy=s1&symbol=btc&status=completed&page=4&limit=25&sort=pnl-desc&snapshot=99',
    ),
  )
  const protocol = changeBacktestFilter(original, 'protocol', 'p2')
  assert.equal(protocol.model, '')
  assert.equal(protocol.strategy, '')
  const model = changeBacktestFilter(original, 'model', 'm2')
  assert.equal(model.protocol, 'p1')
  assert.equal(model.strategy, '')
  for (const next of [protocol, model]) {
    assert.equal(next.page, 1)
    assert.equal(next.snapshot, undefined)
    assert.equal(next.limit, 25)
    assert.equal(next.sort, 'pnl-desc')
    assert.equal(next.symbol, 'btc')
    assert.equal(next.status, 'completed')
  }
  assert.equal(original.page, 4)
  assert.equal(original.strategy, 's1')
})

test('clearing a leaf filter preserves the protocol/model scope', () => {
  const state = readBacktestBrowseState(
    new URLSearchParams('protocol=p1&model=m1&strategy=s1&page=3&snapshot=99'),
  )
  const next = changeBacktestFilter(state, 'strategy', '')
  assert.equal(next.protocol, 'p1')
  assert.equal(next.model, 'm1')
  assert.equal(next.strategy, '')
  assert.equal(next.page, 1)
  assert.equal(next.snapshot, undefined)
})

test('page bounds handle empty results, partial last pages, and obsolete bookmarks', () => {
  assert.deepEqual(backtestPageBounds(0, 25, 12), {
    page: 1,
    pageCount: 1,
    offset: 0,
    start: 0,
    end: 0,
  })
  assert.deepEqual(backtestPageBounds(51, 25, 99), {
    page: 3,
    pageCount: 3,
    offset: 50,
    start: 51,
    end: 51,
  })
  assert.deepEqual(backtestPageBounds(50, 25, 2), {
    page: 2,
    pageCount: 2,
    offset: 25,
    start: 26,
    end: 50,
  })
})

test('page navigation stays bounded while exposing first, last, and adjacent pages', () => {
  assert.deepEqual(backtestPageNumbers(1, 1), [1])
  assert.deepEqual(backtestPageNumbers(2, 4), [1, 2, 3, 4])
  assert.deepEqual(backtestPageNumbers(50, 100), [1, 'ellipsis', 49, 50, 51, 'ellipsis', 100])
  assert.deepEqual(backtestPageNumbers(100, 100), [1, 'ellipsis', 99, 100])
})
