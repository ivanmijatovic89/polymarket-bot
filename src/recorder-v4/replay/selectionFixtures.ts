import type { MarketManifest } from '../storage/manifest.js'

export function eligibleManifest(startMs = 1_000, recordingId = 'capture'): MarketManifest {
  const slug = `btc-updown-5m-${startMs / 1000}`
  return {
    schemaVersion: 4,
    archiveLayout: 'symbol-timeframe',
    recordingId,
    market: {
      slug,
      symbol: 'btc',
      timeframe: '5m',
      conditionId: slug,
      tokenIds: ['up', 'down'],
      outcomes: ['Up', 'Down'],
      startMs,
      endMs: startMs + 300_000,
      twapEnabled: true,
      twapLookbackSeconds: 60,
      resolutionSource: 'chainlink',
      rawJson: '{}',
    },
    coverage: {
      complete: true,
      startedAtMs: startMs,
      endedAtMs: startMs + 300_000,
      missingInitialBook: false,
      gaps: [],
      warnings: [],
    },
    createdAtMs: startMs,
    finalizedAtMs: startMs + 300_000,
    events: {
      key: `recorder-v4/btc/5m/${slug}/${recordingId}/events-${'a'.repeat(64)}.parquet`,
      sha256: 'a'.repeat(64),
      bytes: 100,
      rows: 1,
      firstSequence: '1',
      lastSequence: '1',
    },
  }
}
