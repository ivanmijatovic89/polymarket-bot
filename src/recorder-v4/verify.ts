import { createHash } from 'node:crypto'
import path from 'node:path'
import { CapturedMarketDispatcher } from './replay/dispatcher.js'
import { applyCapturedFeed } from './replay/feedState.js'
import { digestFile } from './storage/files.js'
import { readManifest } from './storage/manifest.js'
import { readCapturedEvents } from './storage/parquet.js'
import type { RecorderFeed } from './types.js'
import {
  OpeningReferenceTracker,
  type OpeningReferenceInspection,
} from './replay/openingReference.js'

export type CaptureVerification = {
  slug: string
  timeframe: string
  rows: number
  ticks: number
  bytes: number
  sha256: string
  replaySha256: string
  complete: boolean
  gaps: number
  sources: Record<string, number>
  feeds: Partial<Record<RecorderFeed, number>>
  firstSequence: string | null
  lastSequence: string | null
  openingReference?: OpeningReferenceInspection
}

/** Verify every row and replay the same tick/feed snapshots without strategy, DB or network I/O. */
export async function verifyCapturePackage(input: string): Promise<CaptureVerification> {
  const directory = ['events.parquet', 'manifest.json'].includes(path.basename(input))
    ? path.dirname(path.resolve(input))
    : path.resolve(input)
  const manifest = await readManifest(path.join(directory, 'manifest.json'))
  const file = path.join(directory, 'events.parquet')
  const digest = await digestFile(file)
  if (digest.bytes !== manifest.events.bytes || digest.sha256 !== manifest.events.sha256)
    throw new Error('Recording bytes differ from the manifest')
  const replay = createHash('sha256')
  const openingReference = new OpeningReferenceTracker(manifest.market)
  const result: CaptureVerification = {
    slug: manifest.market.slug,
    timeframe: manifest.market.timeframe,
    rows: 0,
    ticks: 0,
    ...digest,
    replaySha256: '',
    complete: manifest.coverage.complete,
    gaps: manifest.coverage.gaps.length,
    sources: {},
    feeds: {},
    firstSequence: null,
    lastSequence: null,
  }
  const dispatcher = new CapturedMarketDispatcher({
    market: manifest.market,
    filePath: file,
    config: {
      binanceWsSpotPrice: { symbol: 'btcusdt', tickOnUpdate: true },
      binanceBookTicker: { symbol: 'btcusdt' },
      rtdsCryptoPrices: { chainlinkSymbols: ['btc/usd'], tickOnUpdate: true },
      ...(manifest.market.twapEnabled && manifest.market.twapLookbackSeconds !== null
        ? {
            chainlinkTwap: {
              symbol: 'btc/usd',
              windowSeconds: manifest.market.twapLookbackSeconds,
            },
          }
        : {}),
      polymarketPriceToBeat: { enabled: true },
    },
    onTick: (tick) => {
      result.ticks++
      // The local cache path is intentionally excluded so independent downloads compare equally.
      const source =
        tick.source.kind === 'parquet' ? { ...tick.source, filePath: '<capture>' } : tick.source
      replay.update(
        JSON.stringify(
          {
            source,
            msg: tick.msg,
            snapshot: tick.snapshot,
            feeds: dispatcher.snapshotForTick(tick),
          },
          (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
        ),
      )
      replay.update('\n')
    },
  })
  const knownSources = new Set([
    'polymarket',
    'binance',
    'chainlink',
    'price_to_beat',
    'market_metadata',
    'control',
    'bootstrap',
  ])
  let lastSession: string | null = null
  let lastMonotonic = -1n
  for await (const event of readCapturedEvents(file)) {
    if (!knownSources.has(event.source)) throw new Error('Unknown capture source')
    if (!Number.isSafeInteger(event.receivedAtMs) || event.receivedAtMs < 0)
      throw new Error('Invalid local receipt timestamp')
    if (!/^\d+$/.test(event.monotonicNs)) throw new Error('Invalid monotonic timestamp')
    const monotonic = BigInt(event.monotonicNs)
    // Synthetic state/control envelopes can be inserted at a boundary immediately
    // before the real frame which triggered it; only external receipt clocks compare.
    if (event.source !== 'bootstrap' && event.source !== 'control') {
      if (lastSession === event.sessionId && monotonic < lastMonotonic)
        throw new Error('Monotonic receipt order moved backwards within a session')
      lastSession = event.sessionId
      lastMonotonic = monotonic
    }
    if (event.eventId !== `${event.captureId}:${event.sequence}`)
      throw new Error('Event identity differs from its capture sequence')
    result.rows++
    result.sources[event.source] = (result.sources[event.source] ?? 0) + 1
    const update = applyCapturedFeed({}, event, manifest.market)
    if (update) result.feeds[update.feed] = (result.feeds[update.feed] ?? 0) + 1
    result.firstSequence ??= event.sequence
    result.lastSequence = event.sequence
    openingReference.accept(event)
    await dispatcher.accept(event)
  }
  if (
    result.rows !== manifest.events.rows ||
    result.firstSequence !== manifest.events.firstSequence ||
    result.lastSequence !== manifest.events.lastSequence
  )
    throw new Error('Recording row count or sequence bounds differ from the manifest')
  result.replaySha256 = replay.digest('hex')
  result.openingReference = openingReference.report()
  return result
}
