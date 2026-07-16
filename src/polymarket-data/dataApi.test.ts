import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { fetchWalletTrades, type ApiTrade } from './dataApi.js'
import { RateLimiter } from './rateLimiter.js'

const CID = `0x${'a'.repeat(64)}`
const WALLET = `0x${'b'.repeat(40)}`
const limiter = new RateLimiter(100_000)

function trade(over: Partial<ApiTrade> = {}): ApiTrade {
  return {
    proxyWallet: WALLET,
    side: 'BUY',
    asset: '1',
    conditionId: CID,
    size: 1,
    price: 0.5,
    timestamp: 1,
    outcomeIndex: 0,
    transactionHash: '0xtx',
    ...over,
  }
}

test('wallet trades send user + market + takerOnly=false and preserve identical fills', async (t) => {
  const calls: URL[] = []
  const repeated = trade()
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    calls.push(new URL(String(input)))
    return new Response(JSON.stringify([repeated, repeated]), { status: 200 })
  })
  t.after(() => mock.restoreAll())

  const result = await fetchWalletTrades(CID, WALLET, { limiter })

  assert.equal(result.trades.length, 2)
  assert.equal(result.capped, false)
  assert.equal(calls[0]!.searchParams.get('user'), WALLET)
  assert.equal(calls[0]!.searchParams.get('market'), CID)
  assert.equal(calls[0]!.searchParams.get('takerOnly'), 'false')
})

test('a capped wallet scope retries as independent BUY and SELL combinations', async (t) => {
  const fullPage = Array.from({ length: 1000 }, (_, i) =>
    trade({ transactionHash: `0xunsided${i}` }),
  )
  mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input))
    const side = url.searchParams.get('side')
    const offset = Number(url.searchParams.get('offset'))
    if (side === null) return new Response(JSON.stringify(fullPage), { status: 200 })
    if (offset > 0) return new Response('[]', { status: 200 })
    return new Response(
      JSON.stringify([
        trade({ side: side as 'BUY' | 'SELL', transactionHash: `0x${side.toLowerCase()}` }),
      ]),
      { status: 200 },
    )
  })
  t.after(() => mock.restoreAll())

  const result = await fetchWalletTrades(CID, WALLET, { limiter })

  assert.equal(result.usedSideSplit, true)
  assert.equal(result.capped, false)
  assert.deepEqual(result.trades.map((row) => row.side).sort(), ['BUY', 'SELL'])
})
