import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStrategy } from './feedsParityProbe.v1.js'
import type { MarketTick } from '../strategy/Strategy.js'
import type { PortfolioSnapshot } from '../strategy/Strategy.js'

function makeTick(args: {
  kind: 'live' | 'parquet'
  exchangeTsMs: number
  tsLocalMs?: number
}): MarketTick {
  return {
    source:
      args.kind === 'live'
        ? { kind: 'live', attempt: 1 }
        : {
            kind: 'parquet',
            filePath: '/x.parquet',
            ingestSeq: 1n,
            ...(args.tsLocalMs !== undefined ? { tsLocalMs: args.tsLocalMs } : {}),
          },
    msg: { event_type: 'price_change' } as MarketTick['msg'],
    snapshot: {
      market: 'm1',
      timestamp: args.exchangeTsMs,
      byAssetId: {
        A: { bestBid: 0.4, bestAsk: 0.41 } as never,
      },
    } as MarketTick['snapshot'],
  }
}

const portfolio = {} as PortfolioSnapshot

async function readRows(p: string): Promise<Array<Record<string, unknown>>> {
  // The probe's writer is a serialized async chain — poll briefly for flush.
  for (let i = 0; i < 50; i++) {
    try {
      const text = await fs.readFile(p, 'utf8')
      const rows = text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
      if (rows.length > 0) return rows
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  return []
}

test('probe writes versioned rows with mode-correct clocks and emits no intents', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'parity-probe-'))
  const out = path.join(dir, 'probe.jsonl')
  process.env.FEEDS_PARITY_OUT = out
  try {
    const { strategy } = createStrategy({ heartbeatMs: 1000, logEveryTick: true })
    const before = Date.now()
    const intentsLive = strategy.onMarketTick(
      makeTick({ kind: 'live', exchangeTsMs: 111 }),
      portfolio,
      {
        plugins: {
          externalFeeds: {
            rtdsPolymarketCryptoPrices: {
              chainlink: { symbol: 'btc/usd', tsMs: 5, value: 9.5, receivedAtMs: 6 },
            },
            binanceWsSpotPrice: { symbol: 'btcusdt', tsMs: 7, value: 100.25, receivedAtMs: 8 },
          },
        },
        market: { slug: 's-1' } as never,
      },
    )
    const intentsReplay = strategy.onMarketTick(
      makeTick({ kind: 'parquet', exchangeTsMs: 222, tsLocalMs: 333 }),
      portfolio,
      { plugins: { externalFeeds: {} } },
    )
    assert.deepEqual(intentsLive, [])
    assert.deepEqual(intentsReplay, [])

    const rows = await readRows(out)
    assert.equal(rows.length, 2)
    const [live, replay] = rows as [Record<string, unknown>, Record<string, unknown>]
    assert.equal(live.v, 1)
    assert.equal(live.mode, 'live')
    assert.ok((live.seenAtMs as number) >= before) // Date.now() clock
    assert.equal(live.exchangeTsMs, 111)
    assert.deepEqual(live.binance, { tsMs: 7, value: 100.25 })
    assert.deepEqual(live.chainlink, { tsMs: 5, value: 9.5 })
    assert.equal(live.slug, 's-1')
    assert.deepEqual(live.books, [{ assetId: 'A', bid: 0.4, ask: 0.41 }])

    assert.equal(replay.mode, 'parquet')
    assert.equal(replay.seenAtMs, 333) // tsLocalMs clock, not exchange ts
    assert.equal(replay.exchangeTsMs, 222)
    assert.equal(replay.binance, undefined) // absent key stays absent
  } finally {
    delete process.env.FEEDS_PARITY_OUT
    await fs.rm(dir, { recursive: true, force: true })
  }
})
