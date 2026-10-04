import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DurableMarketStore } from './storage/marketStore.js'
import { verifyCapturePackage } from './verify.js'
import type { CapturedEvent, RecordedMarket } from './types.js'

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'verify-recorder-'))
  t.after(() => rm(spoolDir, { recursive: true, force: true }))
  const market: RecordedMarket = {
    slug: 'btc-updown-5m-1800',
    symbol: 'btc',
    timeframe: '5m',
    conditionId: 'condition',
    tokenIds: ['up', 'down'],
    outcomes: ['Up', 'Down'],
    startMs: 1_800_000,
    endMs: 2_100_000,
    twapEnabled: true,
    twapLookbackSeconds: 60,
    resolutionSource: 'chainlink',
    rawJson: '{}',
  }
  const store = new DurableMarketStore({ spoolDir })
  await store.openMarket(market)
  const event = (
    sequence: number,
    source: CapturedEvent['source'],
    raw: unknown,
  ): CapturedEvent => ({
    schemaVersion: 3,
    captureId: 'capture',
    sessionId: 'session',
    sequence: String(sequence),
    eventId: `capture:${sequence}`,
    receivedAtMs: market.startMs + sequence,
    monotonicNs: String(sequence * 1_000_000),
    source,
    connectionId: source,
    eventType: 'message',
    sourceTimeMs: null,
    rawJson: JSON.stringify(raw),
    detailsJson: null,
  })
  const book = (asset_id: string) => ({
    event_type: 'book',
    market: market.conditionId,
    asset_id,
    bids: [{ price: '0.4', size: '20' }],
    asks: [{ price: '0.6', size: '30' }],
    timestamp: String(market.startMs),
    hash: 'hash',
  })
  await store.append(
    market.slug,
    event(1, 'bootstrap', { kind: 'initial_state', market, books: [], feeds: [] }),
  )
  await store.append(market.slug, event(2, 'polymarket', [book('up'), book('down')]))
  await store.append(
    market.slug,
    event(3, 'binance', {
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', s: 'BTCUSDT', T: market.startMs, p: '100000.25', a: 1 },
    }),
  )
  const ready = await store.finalize(market.slug, {
    complete: false,
    startedAtMs: market.startMs,
    endedAtMs: market.endMs,
    missingInitialBook: true,
    gaps: [],
    warnings: [],
  })
  return { ...ready, spoolDir }
}

test('verification checks every row and produces equal replay digest in an independent cache', async (t) => {
  const { directory, spoolDir } = await fixture(t)
  const before = await verifyCapturePackage(directory)
  assert.equal(before.rows, 3)
  assert.equal(before.ticks, 3)
  assert.equal(before.feeds.binance_agg_trade, 1)
  assert.equal(before.complete, false)
  const cache = path.join(spoolDir, 'download-cache')
  await cp(directory, cache, { recursive: true })
  const after = await verifyCapturePackage(path.join(cache, 'manifest.json'))
  assert.deepEqual(after, before)
})

test('verification rejects corrupt event bytes before replay', async (t) => {
  const { directory } = await fixture(t)
  const file = path.join(directory, 'events.parquet')
  const bytes = await readFile(file)
  bytes[20] = bytes[20]! ^ 1
  await writeFile(file, bytes)
  await assert.rejects(verifyCapturePackage(directory), /bytes differ/)
})

test('verification rejects manifest row and sequence claims inconsistent with the actual stream', async (t) => {
  const { directory, manifest } = await fixture(t)
  const file = path.join(directory, 'manifest.json')
  await writeFile(file, JSON.stringify({ ...manifest, events: { ...manifest.events, rows: 100 } }))
  await assert.rejects(verifyCapturePackage(directory), /row count or sequence bounds/)
  await writeFile(
    file,
    JSON.stringify({ ...manifest, events: { ...manifest.events, firstSequence: '2' } }),
  )
  await assert.rejects(verifyCapturePackage(directory), /row count or sequence bounds/)
})
