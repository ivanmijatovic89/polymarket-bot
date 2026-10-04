import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { MarketEngine, type EngineTick } from '../../market/MarketEngine.js'
import { RotatingParquetEventRecorder } from '../../parquet/io/eventWriter.js'
import { replayOrderBookForMarket } from '../../parquet/replay/replayOrderBookForMarket.js'

const book = (timestamp: number, asset = 'up', market = 'market') => ({
  event_type: 'book',
  market,
  asset_id: asset,
  timestamp: String(timestamp),
  hash: '',
  bids: [{ price: '0.4', size: String(timestamp) }],
  asks: [{ price: '0.6', size: '2' }],
})

test('concurrent websocket frames keep array children contiguous for synchronous live and asynchronous replay callbacks', async () => {
  const frames = [JSON.stringify([book(1), book(2, 'down')]), JSON.stringify(book(3))]
  const seenLive: string[] = []
  const live = new MarketEngine({
    onTick: (tick) => {
      seenLive.push(tick.msg.timestamp)
    },
  })
  const first = live.handleRaw({ rawJson: frames[0]!, source: { kind: 'live', attempt: 1 } })
  assert.deepEqual(seenLive, ['1', '2'], 'live callbacks finish the entire frame before returning')
  const second = live.handleRaw({ rawJson: frames[1]!, source: { kind: 'live', attempt: 1 } })
  assert.deepEqual(seenLive, ['1', '2', '3'])
  await Promise.all([first, second])

  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const seenReplay: string[] = []
  const replay = new MarketEngine({
    onTick: async (tick: EngineTick) => {
      seenReplay.push(tick.msg.timestamp)
      if (tick.msg.timestamp === '1') await blocked
    },
  })
  const replayFirst = replay.handleRaw({
    rawJson: frames[0]!,
    source: { kind: 'live', attempt: 1 },
  })
  const replaySecond = replay.handleRaw({
    rawJson: frames[1]!,
    source: { kind: 'live', attempt: 1 },
  })
  assert.deepEqual(seenReplay, ['1'])
  release()
  await Promise.all([replayFirst, replaySecond])
  assert.deepEqual(seenReplay, seenLive)
  assert.deepEqual(replay.snapshot(), live.snapshot())
})

test('legacy recorded replay emits every initial array child and retains the first-market selection rule', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'legacy-array-parity-'))
  try {
    const recorder = new RotatingParquetEventRecorder({ baseDir: directory })
    const frames = [
      JSON.stringify([book(1), book(2, 'down')]),
      JSON.stringify(book(3, 'foreign-token', 'foreign-market')),
      JSON.stringify(book(4)),
    ]
    for (const [index, rawJson] of frames.entries())
      await recorder.append({
        marketId: 'market',
        fileKey: 'fixture',
        row: {
          ingest_seq: BigInt(index + 1),
          ts_local_ms: BigInt(index + 1),
          ts_exchange_ms: BigInt(index + 1),
          event_type: 'book',
          raw_json: rawJson,
        },
      })
    await recorder.closeAll()
    const seen: string[] = []
    await replayOrderBookForMarket({
      filePaths: [path.join(directory, 'fixture.parquet')],
      onSnapshot: (snapshot, event) => {
        seen.push(event.msg.timestamp)
        assert.equal(snapshot.market, 'market')
        assert.equal(snapshot.byAssetId['foreign-token'], undefined)
        if (seen.length < 3) assert.equal(event.rawJson, frames[0])
      },
    })
    assert.deepEqual(seen, ['1', '2', '4'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
