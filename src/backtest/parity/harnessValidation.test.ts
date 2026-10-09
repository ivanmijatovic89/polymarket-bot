import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MarketJobData } from '../jobTypes.js'
import { compareJobsH1 } from './harnessValidation.js'

const job = (over: Partial<MarketJobData> = {}): MarketJobData =>
  ({
    startingCapital: 500,
    submissionUid: 'parity-s',
    batchUid: 'parity-s',
    idx: 0,
    filePath: '/root/data/events/telonex/delta-typed/btc/15m/s.parquet',
    slug: 'btc-updown-15m-1775417400',
    marketMeta: { slug: 's', outcomes: ['UP', 'DOWN'] },
    marketResolution: { tokenMap: { UP: 'a', DOWN: 'b' }, outcome: 'UP' },
    strategyId: 'feed-exerciser',
    strategyParams: { tickOnUpdate: true },
    inputMode: 'telonex-delta',
    order: 'recorded',
    timeDriven: false,
    latency: { delayMs: 0, jitterMs: 0 },
    strategyWindow: { startMs: 1, endMs: 2 },
    commitSha: 'aaa',
    ...over,
  }) as MarketJobData

describe('H-1 harness validation (60 §4.3)', () => {
  it('ignores idx, batch and submission fields, commitSha, and relative vs absolute dataset paths', () => {
    const producer = job({
      idx: 7,
      batchUid: 'b',
      submissionUid: 'u',
      commitSha: 'bbb',
      filePath: 'data/events/telonex/delta-typed/btc/15m/s.parquet',
    })
    assert.deepEqual(compareJobsH1(job(), producer, '/root/data'), [])
  })

  it('reports every semantic difference with its path', () => {
    const producer = job({ latency: { delayMs: 140, jitterMs: 0 }, gammaPriceToBeat: null })
    assert.deepEqual(compareJobsH1(job(), producer, '/root/data'), [
      { path: '$.gammaPriceToBeat', harness: undefined, producer: null },
      { path: '$.latency.delayMs', harness: 0, producer: 140 },
    ])
  })
})
