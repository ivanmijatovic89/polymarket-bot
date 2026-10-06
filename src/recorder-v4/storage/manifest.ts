import { assertArchiveKey } from './namespace.js'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

import type { MarketCoverage, RecordedMarket } from '../types.js'

export type MarketManifest = {
  schemaVersion: 4
  /** V4 always has symbol/timeframe hierarchy. */
  archiveLayout: 'symbol-timeframe'
  recordingId: string
  market: RecordedMarket
  coverage: MarketCoverage
  createdAtMs: number
  finalizedAtMs: number
  events: {
    key: string
    sha256: string
    bytes: number
    rows: number
    firstSequence: string | null
    lastSequence: string | null
  }
}

const finiteTime = z.number().finite().nonnegative()
const sequence = z.string().regex(/^\d+$/).nullable()
export const marketManifestSchema = z
  .object({
    schemaVersion: z.literal(4),
    archiveLayout: z.literal('symbol-timeframe'),
    recordingId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
    market: z
      .object({
        slug: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/),
        symbol: z.literal('btc'),
        timeframe: z.enum(['5m', '15m']),
        conditionId: z.string(),
        tokenIds: z.tuple([z.string(), z.string()]),
        outcomes: z.tuple([z.string(), z.string()]),
        startMs: finiteTime,
        endMs: finiteTime,
        twapEnabled: z.boolean(),
        twapLookbackSeconds: z.number().finite().positive().nullable(),
        resolutionSource: z.string().nullable(),
        rawJson: z.string(),
      })
      .refine(
        (market) =>
          Number.isSafeInteger(market.startMs) &&
          market.startMs % 1_000 === 0 &&
          market.slug === `${market.symbol}-updown-${market.timeframe}-${market.startMs / 1_000}` &&
          market.endMs === market.startMs + (market.timeframe === '5m' ? 300_000 : 900_000),
        { message: 'Manifest market identity or duration does not match its slug' },
      ),
    coverage: z.object({
      complete: z.boolean(),
      startedAtMs: finiteTime,
      endedAtMs: finiteTime,
      missingInitialBook: z.boolean(),
      gaps: z.array(
        z.object({
          feed: z.enum([
            'polymarket',
            'binance_agg_trade',
            'binance_book_ticker',
            'chainlink_spot',
            'chainlink_twap',
            'price_to_beat',
          ]),
          startMs: finiteTime,
          endMs: finiteTime.nullable(),
          reason: z.string(),
          certainty: z.enum(['confirmed', 'uncertain']),
        }),
      ),
      warnings: z.array(z.string()),
    }),
    createdAtMs: finiteTime,
    finalizedAtMs: finiteTime,
    events: z.object({
      key: z
        .string()
        .min(1)
        .refine((key) => !key.startsWith('/') && !key.split('/').includes('..')),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().nonnegative(),
      rows: z.number().int().nonnegative(),
      firstSequence: sequence,
      lastSequence: sequence,
    }),
  })
  .superRefine((manifest, context) => {
    try {
      assertArchiveKey(manifest.events.key)
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['events', 'key'],
        message: 'Archive key must remain inside recorder-v4/',
      })
    }
    if (manifest.archiveLayout !== 'symbol-timeframe') return
    const { market, recordingId, events } = manifest
    const suffix = `/${market.symbol}/${market.timeframe}/${market.slug}/${recordingId}/events-${events.sha256}.parquet`
    if (
      !events.key.endsWith(suffix) ||
      events.key.length <= suffix.length ||
      events.key.split('/').some((part) => !part || part === '.')
    )
      context.addIssue({
        code: 'custom',
        path: ['events', 'key'],
        message:
          'Structured archive key does not match its market, duration, recording ID or digest',
      })
  })

export function parseManifest(json: string): MarketManifest {
  return marketManifestSchema.parse(JSON.parse(json))
}

export async function readManifest(file: string): Promise<MarketManifest> {
  return parseManifest(await readFile(file, 'utf8'))
}
