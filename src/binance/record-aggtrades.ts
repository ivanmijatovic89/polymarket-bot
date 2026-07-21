import '../config/env.js'
import { promises as fs } from 'node:fs'
import * as parquet from '@dsnp/parquetjs'
import {
  createBinanceWsSpotPriceClient,
  type AggTradeMessage,
} from '../trading/feeds/binanceWsSpotPriceClient.js'
import { installSignalHandlers, installProcessCrashHandlers } from '../utils/runtime.js'
import { moveNoReplace } from '../utils/moveNoReplace.js'
import { parseBinanceCliArgs } from './cliArgs.js'
import { recordingHourPath, recordingStatusPath, recordingsDir, utcDateOf } from './paths.js'

/**
 * Record the LIVE Binance WS aggTrade stream to hourly parquet files, keeping
 * every field as received (prices/qtys as raw strings) plus the local receive
 * timestamp. This is the ground-truth side of the live-vs-dump verification:
 * `binance:verify-aggtrades` joins these files against the data.binance.vision
 * daily dumps on agg_trade_id.
 *
 *   npm run binance:record-aggtrades -- --pair BTCUSDT [--hours 8]
 */
export const recordedAggTradeParquetSchema = new parquet.ParquetSchema({
  agg_trade_id: { type: 'INT64', compression: 'GZIP' },
  price: { type: 'UTF8', compression: 'GZIP' },
  qty: { type: 'UTF8', compression: 'GZIP' },
  first_trade_id: { type: 'INT64', compression: 'GZIP' },
  last_trade_id: { type: 'INT64', compression: 'GZIP' },
  ts_ms: { type: 'INT64', compression: 'GZIP' },
  event_ts_ms: { type: 'INT64', compression: 'GZIP' },
  is_buyer_maker: { type: 'BOOLEAN', compression: 'GZIP' },
  received_at_ms: { type: 'INT64', compression: 'GZIP' },
  symbol: { type: 'UTF8', compression: 'GZIP' },
})

type Args = { pair: string; hours?: number }

// Node's setTimeout delay is a 32-bit int; beyond it the timer fires after
// ~1 ms, which would "successfully" shut the recorder down instantly.
const MAX_HOURS = Math.floor((2 ** 31 - 1) / 3_600_000)

function parseArgs(argv: string[]): Args {
  let hours: number | undefined
  const { pair } = parseBinanceCliArgs({
    argv,
    usage: 'Usage: npm run binance:record-aggtrades -- --pair BTCUSDT [--hours 8]',
    flags: {
      '--hours': {
        kind: 'value',
        set: (v) => {
          const n = Number(v)
          // Reject garbage loudly: a silently dropped --hours would leave an
          // unattended recording running forever.
          if (!Number.isFinite(n) || n <= 0 || n > MAX_HOURS) {
            throw new Error(
              `invalid --hours value: ${JSON.stringify(v)} (expected 0 < hours <= ${MAX_HOURS}; omit --hours to record indefinitely)`,
            )
          }
          hours = n
        },
      },
    },
  })
  return { pair, ...(hours !== undefined ? { hours } : {}) }
}

function hourKeyOf(ms: number): string {
  return `${utcDateOf(ms)}T${String(new Date(ms).getUTCHours()).padStart(2, '0')}`
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'binance:record' })
  const args = parseArgs(process.argv.slice(2))
  const feedSymbol = args.pair.toLowerCase()

  await fs.mkdir(recordingsDir(args.pair), { recursive: true })
  const statusPath = recordingStatusPath(args.pair)
  const logStatus = (event: Record<string, unknown>): void => {
    void fs
      .appendFile(statusPath, `${JSON.stringify({ ts_ms: Date.now(), ...event })}\n`)
      .catch((err) => console.warn('[binance:record] status append failed:', err))
  }

  let writer: parquet.ParquetWriter | undefined
  let writerHourKey = ''
  let writerTmpPath = ''
  let writerFinalPath = ''
  let rowsInHour = 0
  let rowsTotal = 0

  const closeWriter = async (): Promise<void> => {
    if (!writer) return
    const w = writer
    writer = undefined
    await w.close()
    if (rowsInHour > 0) {
      const target = await moveNoReplace(writerTmpPath, writerFinalPath)
      console.log(`[binance:record] closed ${target} rows=${rowsInHour}`)
    } else {
      await fs.rm(writerTmpPath, { force: true }).catch(() => {})
    }
    rowsInHour = 0
  }

  // All parquet operations run on this serialized chain: appends stay ordered
  // and hourly rotation can never interleave with an in-flight appendRow.
  let chain: Promise<void> = Promise.resolve()
  let chainErr: Error | undefined
  const enqueue = (fn: () => Promise<void>): void => {
    chain = chain.then(fn).catch((err) => {
      chainErr ??= err instanceof Error ? err : new Error(String(err))
      console.error('[binance:record] write failed:', err)
    })
  }

  const appendAggTrade = (agg: AggTradeMessage, receivedAtMs: number): void => {
    // WS frames already buffered when shutdown starts would otherwise enqueue
    // AFTER closeWriter, reopening a writer whose tmp file is abandoned when
    // process.exit fires (rows silently dropped into a stray .tmp). Counted
    // and reported so verify-aggtrades gap analysis isn't left guessing.
    if (stopping) {
      droppedAtShutdown++
      return
    }
    enqueue(async () => {
      const hourKey = hourKeyOf(receivedAtMs)
      if (!writer || hourKey !== writerHourKey) {
        await closeWriter()
        const date = hourKey.slice(0, 10)
        const hour = Number(hourKey.slice(11, 13))
        writerFinalPath = recordingHourPath(args.pair, date, hour)
        writerTmpPath = `${writerFinalPath}.${process.pid}.tmp`
        writer = await parquet.ParquetWriter.openFile(recordedAggTradeParquetSchema, writerTmpPath)
        writerHourKey = hourKey
        console.log(`[binance:record] opened ${writerFinalPath}`)
      }
      await writer.appendRow({
        agg_trade_id: BigInt(agg.a),
        price: agg.p,
        qty: agg.q,
        first_trade_id: BigInt(agg.f),
        last_trade_id: BigInt(agg.l),
        ts_ms: BigInt(agg.T),
        event_ts_ms: BigInt(agg.E),
        is_buyer_maker: agg.m,
        received_at_ms: BigInt(receivedAtMs),
        symbol: agg.s.toLowerCase(),
      })
      rowsInHour++
      rowsTotal++
    })
  }

  let stopping = false
  let droppedAtShutdown = 0

  const client = createBinanceWsSpotPriceClient({
    symbol: feedSymbol,
    onPrice: () => {},
    onAggTrade: appendAggTrade,
    onStatus: (s) => {
      console.log(`[binance:record] ws ${s.kind} attempt=${s.attempt}${s.info ? ` ${s.info}` : ''}`)
      logStatus({ kind: s.kind, attempt: s.attempt, info: s.info })
    },
  })

  const shutdown = (reason: string): void => {
    if (stopping) return
    stopping = true
    console.log(`[binance:record] stopping (${reason}); draining writes...`)
    logStatus({ kind: 'recorder-stop', info: reason })
    client.stop()
    enqueue(closeWriter)
    void chain.then(async () => {
      if (droppedAtShutdown > 0) {
        console.warn(
          `[binance:record] ${droppedAtShutdown} buffered trade(s) discarded at shutdown (after recorder-stop)`,
        )
        // Awaited (unlike logStatus) so process.exit can't cut the append off.
        await fs
          .appendFile(
            statusPath,
            `${JSON.stringify({ ts_ms: Date.now(), kind: 'recorder-dropped-at-shutdown', count: droppedAtShutdown })}\n`,
          )
          .catch(() => {})
      }
      console.log(`[binance:record] done. total rows=${rowsTotal}`)
      process.exit(chainErr ? 1 : 0)
    })
  }

  installSignalHandlers({ onSignal: (sig) => shutdown(sig) })
  if (args.hours) {
    setTimeout(() => shutdown(`--hours ${args.hours} elapsed`), args.hours * 3_600_000)
  }

  const statsTimer = setInterval(() => {
    console.log(`[binance:record] rows total=${rowsTotal} current-hour=${rowsInHour}`)
  }, 60_000)
  statsTimer.unref()

  // Sleep/freeze detection: when the machine suspends (laptop lid closed),
  // the process freezes without any WS close event, so the status log would
  // show nothing while trades silently go missing. A wall-clock jump on this
  // 1s heartbeat marks the frozen interval as an excusable gap for
  // `binance:verify-aggtrades`.
  let lastBeatMs = Date.now()
  const beatTimer = setInterval(() => {
    const now = Date.now()
    if (now - lastBeatMs > 10_000) {
      console.warn(
        `[binance:record] clock jump detected (${((now - lastBeatMs) / 1000).toFixed(0)}s) — machine slept?`,
      )
      logStatus({ kind: 'clock-jump', gap_from_ms: lastBeatMs, gap_to_ms: now })
    }
    lastBeatMs = now
  }, 1_000)
  beatTimer.unref()

  logStatus({ kind: 'recorder-start', info: `${feedSymbol}@aggTrade` })
  console.log(`[binance:record] recording ${feedSymbol}@aggTrade → ${recordingsDir(args.pair)}`)
  client.start()
}

main().catch((err) => {
  console.error('[binance:record] fatal:', err)
  process.exit(1)
})
