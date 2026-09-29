import test from 'node:test'
import assert from 'node:assert/strict'
import { floorIndex, TraceCache } from '../../components/simulator/playback'
import type { TraceManifest, TraceChunk } from '@bot/backtest/simulator/contracts'

test('seek uses the last tick in original order at equal timestamps', () => {
  assert.equal(
    floorIndex([1, 1, 2, 3, 3], 3, (x) => x),
    4,
  )
  assert.equal(
    floorIndex([1, 2, 4], 3, (x) => x),
    1,
  )
  assert.equal(
    floorIndex([1, 2], 0, (x) => x),
    0,
  )
})
test('chunk seek restores action state and feed context, with a bounded cache', async () => {
  const originalFetch = globalThis.fetch
  const requests: number[] = []
  const chunks = Array.from(
    { length: 5 },
    (_, i) =>
      ({
        version: 1,
        frames: [
          {
            tick: i,
            time: i * 1000,
            state: 1,
            context: 1,
            actions: [{ seq: 10 + i, state: 0, context: 0 }],
          },
        ],
        states: [{ fills: i }, { fills: i + 1 }],
        contexts: ['before', 'after'],
      }) as unknown as TraceChunk,
  )
  globalThis.fetch = (async (url: string) => {
    const id = Number(url.split('/').at(-1))
    requests.push(id)
    return Response.json(chunks[id])
  }) as typeof fetch
  try {
    const manifest = {
      chunks: chunks.map((_, i) => ({
        id: i,
        firstTick: i,
        lastTick: i,
        startTime: i * 1000,
        endTime: i * 1000,
      })),
    } as TraceManifest
    const cache = new TraceCache('session', manifest)
    for (let i = 0; i < 5; i++) await cache.at({ tick: i, actionSeq: null })
    const next = await cache.at({ tick: 4, actionSeq: 14 })
    assert.equal(next.state.fills, 4)
    assert.equal(next.context, 'before')
    assert.equal(requests.length, 5)
    await cache.at({ tick: 0, actionSeq: null })
    assert.equal(requests.length, 6)
    assert.equal(await cache.atTime(2500), 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
