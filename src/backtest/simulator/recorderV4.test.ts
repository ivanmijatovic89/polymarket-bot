import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { runSingleMarket, type RunSingleMarketInput } from '../runSingleMarket.js'
import { captureResolvedTrace } from './captureTrace.js'
import type { ReplayProvenance, TraceChunk } from './contracts.js'
import { writeCapturedEvents } from '../../recorder-v4/storage/compactWriter.js'
import { digestFile } from '../../recorder-v4/storage/files.js'
import type { MarketManifest } from '../../recorder-v4/storage/manifest.js'
import { captureMarketMetadata } from '../../recorder-v4/replay/package.js'
import type { CapturedEvent, RecordedMarket } from '../../recorder-v4/types.js'
import {
  ExternalFeedsRequestPlugin,
  type ExternalFeedsRequestConfig,
} from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'

for (const timeframe of ['5m', '15m'] as const) {
  test(`V4 ${timeframe} simulator preserves CLI results, feed receipt ordering and earlier cursor snapshots`, async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sim-v4-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const market: RecordedMarket = {
      slug: `btc-updown-${timeframe}-1000`,
      symbol: 'btc',
      timeframe,
      conditionId: 'm',
      tokenIds: ['up', 'down'],
      outcomes: ['Up', 'Down'],
      startMs: 1_000_000,
      endMs: 1_000_000 + (timeframe === '5m' ? 300_000 : 900_000),
      twapEnabled: true,
      twapLookbackSeconds: 60,
      resolutionSource: 'chainlink',
      rawJson: '{}',
    }
    const frame = (
      sequence: number,
      source: CapturedEvent['source'],
      raw: unknown,
    ): CapturedEvent => ({
      schemaVersion: 4,
      captureId: 'capture',
      sessionId: 'session',
      sequence: String(sequence),
      eventId: `capture:${sequence}`,
      receivedAtMs: market.startMs,
      monotonicNs: String(sequence * 1000),
      source,
      connectionId: source,
      eventType: source,
      sourceTimeMs: null,
      rawJson: JSON.stringify(raw),
      detailsJson: null,
    })
    const book = (asset = 'up') => ({
      event_type: 'book',
      market: 'm',
      asset_id: asset,
      timestamp: String(market.startMs),
      hash: 'h',
      bids: [{ price: '0.4', size: '20' }],
      asks: [{ price: '0.6', size: '20' }],
    })
    const events = [
      frame(1, 'polymarket', [book(), book('down')]),
      frame(2, 'binance', {
        stream: 'btcusdt@aggTrade',
        data: { e: 'aggTrade', s: 'BTCUSDT', T: market.startMs - 5, p: '100', a: 1, q: '1' },
      }),
      frame(3, 'binance', {
        stream: 'btcusdt@bookTicker',
        data: { s: 'BTCUSDT', u: 7, b: '99', B: '2', a: '101', A: '3' },
      }),
      frame(4, 'chainlink', {
        channel: 'price.crypto',
        payload: {
          symbol: 'btcusd',
          source: 'chainlink',
          timestamp: market.startMs,
          value: 102,
          full_accuracy_value: '102',
        },
      }),
      frame(5, 'chainlink', {
        channel: 'price.crypto.twap',
        payload: {
          symbol: 'btcusd',
          source: 'chainlink',
          timestamp: market.startMs,
          full_accuracy_value: '101.5',
          window_seconds: 60,
        },
      }),
      {
        ...frame(6, 'price_to_beat', { openPrice: 101.5 }),
        detailsJson: JSON.stringify({
          marketSlug: market.slug,
          request: {
            eventStartTime: new Date(market.startMs).toISOString(),
            endDate: new Date(market.endMs).toISOString(),
            httpStatus: 200,
          },
        }),
      },
      frame(7, 'polymarket', book()),
      frame(8, 'binance', {
        stream: 'btcusdt@aggTrade',
        data: { e: 'aggTrade', s: 'BTCUSDT', T: market.startMs, p: '200', a: 2, q: '1' },
      }),
      frame(9, 'polymarket', book()),
    ]
    const filePath = path.join(dir, 'events.parquet')
    await writeCapturedEvents(filePath, events)
    const digest = await digestFile(filePath)
    const manifest: MarketManifest = {
      schemaVersion: 4,
      archiveLayout: 'symbol-timeframe',
      recordingId: 'test',
      market,
      coverage: {
        complete: true,
        startedAtMs: market.startMs,
        endedAtMs: market.endMs,
        missingInitialBook: false,
        gaps: [],
        warnings: [],
      },
      createdAtMs: market.startMs,
      finalizedAtMs: market.endMs,
      events: {
        key: `recorder-v4/btc/${timeframe}/${market.slug}/test/events-${digest.sha256}.parquet`,
        ...digest,
        rows: events.length,
        firstSequence: '1',
        lastSequence: '9',
      },
    }
    const config: ExternalFeedsRequestConfig = {
      binanceWsSpotPrice: {},
      binanceBookTicker: {},
      rtdsCryptoPrices: { chainlinkSymbols: ['btc/usd'] },
      chainlinkTwap: { windowSeconds: 60 },
      polymarketPriceToBeat: { enabled: true, source: 'chainlink-opening-twap' },
    }
    const seen: ExternalFeedsSnapshot[][] = []
    const input: RunSingleMarketInput = {
      idx: 0,
      filePath,
      slug: market.slug,
      marketMeta: captureMarketMetadata(manifest),
      marketResolution: { tokenMap: { UP: 'up', DOWN: 'down' }, outcome: 'UP' },
      strategyId: 'sim-v4',
      strategyParams: {},
      inputMode: 'recorder-v4',
      recorderV4: { manifest },
      order: 'recorded',
      timeDriven: false,
      latency: { delayMs: 0, jitterMs: 0 },
      machineId: 'test',
      commitSha: 'test',
      strategyDefinition: {
        id: 'sim-v4',
        schema: z.strictObject({}),
        create: () => {
          const samples: ExternalFeedsSnapshot[] = []
          seen.push(samples)
          let placed = false
          return {
            plugins: [new ExternalFeedsRequestPlugin(config)],
            strategy: {
              name: 'sim-v4',
              onAccountEvent: () => [],
              onMarketTick: (_tick, _portfolio, ctx) => {
                const snapshot = ctx?.plugins?.externalFeeds as ExternalFeedsSnapshot
                samples.push(structuredClone(snapshot))
                if (placed || !snapshot.binanceWsSpotPrice) return []
                placed = true
                return [
                  {
                    kind: 'place_limit',
                    clientOrderId: 'fixed-order',
                    assetId: 'up',
                    side: 'BUY',
                    price: 0.7,
                    size: 2,
                    orderType: 'FOK',
                  },
                ]
              },
            },
          }
        },
      },
    }
    const direct = await runSingleMarket(input)
    assert.ok(direct.marketStats)
    const provenance: ReplayProvenance = {
      runId: 1,
      slug: market.slug,
      marketIndex: 0,
      strategy: 'sim-v4',
      params: {},
      artifactSha256: null,
      originalCommit: 'test',
      currentCommit: 'test',
      sourceFingerprint: 'test',
      dataset: filePath,
      datasetSha256: digest.sha256,
      inputMode: 'recorder-v4',
      order: 'recorded',
      timeDriven: false,
      latency: input.latency,
      window: null,
      initialCapital: 1000,
      outcome: 'UP',
      settings: {},
      warnings: [],
    }
    const result = await captureResolvedTrace(
      {
        input,
        provenance,
        tokens: { UP: 'up', DOWN: 'down' },
        expected: { ...direct.marketStats, eventsProcessed: direct.eventsProcessed },
      },
      dir,
    )
    assert.equal(result.resultMatches, true)
    assert.deepEqual(seen[0], seen[1])
    const chunk = JSON.parse(
      gunzipSync(await readFile(path.join(dir, '0.json.gz'))).toString(),
    ) as TraceChunk
    const contexts = chunk.frames.map(
      (frame) => chunk.contexts[frame.context] as ExternalFeedsSnapshot,
    )
    assert.equal(contexts[0]?.binanceWsSpotPrice, undefined)
    assert.equal(contexts[1]?.binanceWsSpotPrice, undefined)
    assert.equal(contexts[2]?.binanceWsSpotPrice?.value, 100)
    assert.equal(contexts[2]?.binanceBookTicker?.bidPrice, '99')
    assert.equal(contexts[2]?.rtdsPolymarketCryptoPrices?.chainlink?.value, 102)
    assert.equal(contexts[2]?.chainlinkTwap?.value, 101.5)
    assert.equal(contexts[2]?.polymarketPriceToBeat?.openPrice, 101.5)
    assert.equal(contexts.at(-1)?.binanceWsSpotPrice?.value, 200)
    assert.deepEqual(
      chunk.frames.map((frame) => frame.ingestSeq),
      ['1', '1', '7', '9'],
    )
    const incomplete = { ...manifest, coverage: { ...manifest.coverage, missingInitialBook: true } }
    await assert.rejects(
      captureResolvedTrace(
        {
          input: { ...input, recorderV4: { manifest: incomplete } },
          provenance,
          tokens: { UP: 'up', DOWN: 'down' },
          expected: { ...direct.marketStats, eventsProcessed: direct.eventsProcessed },
        },
        dir,
      ),
      /incomplete_capture/,
    )
    const outage = await captureResolvedTrace(
      {
        input: { ...input, recorderV4: { manifest: incomplete, allowGaps: true } },
        provenance,
        tokens: { UP: 'up', DOWN: 'down' },
        expected: { ...direct.marketStats, eventsProcessed: direct.eventsProcessed },
      },
      dir,
    )
    assert.equal(outage.ticks, result.ticks)
  })
}
