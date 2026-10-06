import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { MarketEngine, type EngineTick } from '../../market/MarketEngine.js'
import {
  decodeMarketChannelFrame,
  decodeMarketChannelMessage,
} from '../../market/marketChannelDecoder.js'
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

test('raw and decoded frames preserve bootstrap, message fields, child indices, and book snapshots', async () => {
  const frames = [
    [book(1), book(2, 'down')],
    [book(3), { ...book(4, 'down'), extra: { exact: '123.000000000000000001' } }],
    [
      {
        event_type: 'price_change',
        market: 'market',
        timestamp: '5',
        price_changes: [
          { asset_id: 'up', price: '0.4', size: '0', side: 'BUY', hash: 'exact-hash' },
          { asset_id: 'down', price: '0.61', size: '3', side: 'SELL', hash: 'other-hash' },
        ],
      },
    ],
  ].map((frame) => JSON.stringify(frame))
  const seen: EngineTick[][] = [[], []]
  const engines = seen.map(
    (ticks) =>
      new MarketEngine({
        onTick: (tick) => {
          ticks.push(tick)
        },
      }),
  )
  for (const [index, rawJson] of frames.entries()) {
    const args = {
      source: {
        kind: 'parquet' as const,
        filePath: 'capture',
        ingestSeq: BigInt(index),
        tsLocalMs: 10 + index,
      },
      bootstrap: index === 0,
    }
    const rawResult = await engines[0]!.handleRaw({ ...args, rawJson })
    const decodedResult = await engines[1]!.handleDecoded({
      ...args,
      messages: decodeMarketChannelFrame(rawJson),
    })
    assert.deepEqual(decodedResult, rawResult)
  }
  assert.deepEqual(seen[1], seen[0])
  assert.deepEqual(
    seen[0]!.map((tick) => tick.msg.timestamp),
    ['3', '4', '5'],
  )
  assert.deepEqual(
    seen[0]!.map((tick) => tick.source.kind === 'parquet' && tick.source.frameIndex),
    [0, 1, undefined],
  )
  assert.deepEqual(engines[1]!.snapshot(), engines[0]!.snapshot())
})

test('raw and decoded calls share one frame queue and decoded synchronous callbacks do not yield', async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const seen: string[] = []
  const source = { kind: 'live' as const, attempt: 1 }
  const engine = new MarketEngine({
    onTick: (tick) => {
      seen.push(tick.msg.timestamp)
      if (tick.msg.timestamp === '1') return blocked
    },
  })
  const first = engine.handleDecoded({
    source,
    messages: decodeMarketChannelFrame(JSON.stringify([book(1), book(2)])),
  })
  const second = engine.handleRaw({ source, rawJson: JSON.stringify(book(3)) })
  const third = engine.handleDecoded({
    source,
    messages: decodeMarketChannelFrame(JSON.stringify([book(4), book(5)])),
  })
  assert.deepEqual(seen, ['1'])
  release()
  await Promise.all([first, second, third])
  assert.deepEqual(seen, ['1', '2', '3', '4', '5'])
  const synchronous = engine.handleDecoded({
    source,
    messages: decodeMarketChannelFrame(JSON.stringify([book(6), book(7)])),
  })
  assert.deepEqual(seen, ['1', '2', '3', '4', '5', '6', '7'])
  await synchronous
})

test('frame and single-message decoders keep the same fields and ignore non-market members', () => {
  const raw = JSON.stringify({
    ...book(1),
    extra: { nested: [true, null, '0.123456789123456789'] },
  })
  assert.deepEqual(decodeMarketChannelFrame(raw), [decodeMarketChannelMessage(raw)])
  assert.deepEqual(
    decodeMarketChannelFrame(
      `[null,7,[],{"event_type":"disconnect"},${raw},{"event_type":"new_market"}]`,
    ),
    [decodeMarketChannelMessage(raw)],
  )
  assert.deepEqual(decodeMarketChannelFrame('{broken'), [])
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
