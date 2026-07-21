import '../../config/env.js'
import { promises as fs } from 'node:fs'
import * as parquet from '@dsnp/parquetjs'
import { createRtdsCryptoPricesClient } from '../../trading/feeds/rtdsCryptoPricesClient.js'
import { installSignalHandlers, installProcessCrashHandlers } from '../../utils/runtime.js'
import { moveNoReplace } from '../../utils/moveNoReplace.js'
import { utcDateOf } from '../../binance/paths.js'
import { parseCryptoPricesCliArgs } from './cliArgs.js'
import {
  chainlinkFeedSymbolForMarketSymbol,
  recordingHourPath,
  recordingStatusPath,
  recordingsDir,
} from './paths.js'

/**
 * Record the LIVE RTDS `crypto_prices_chainlink` stream to hourly parquet
 * files, keeping BOTH clocks (chainlink round time + Polymarket broadcast
 * time), the raw value token, and the local receive timestamp. This is the
 * ground-truth side of the live-vs-Telonex verification:
 * `telonex:crypto-prices:verify` joins these files against the Telonex
 * `crypto_prices` day files on (symbol, round time) and measures the
 * broadcast→bot latency that `BACKTEST_RTDS_CHAINLINK_LATENCY_MS` models.
 *
 *   npm run telonex:crypto-prices:record-rtds -- --asset btcusd [--hours 30]
 */
export const recordedRtdsChainlinkParquetSchema = new parquet.ParquetSchema({
  symbol: { type: 'UTF8', compression: 'GZIP' },
  /** payload.timestamp — the chainlink round time (what live feeds the store as tsMs). */
  ts_ms: { type: 'INT64', compression: 'GZIP' },
  /** Top-level RTDS message timestamp — when Polymarket broadcast the round. */
  server_ts_ms: { type: 'INT64', optional: true, compression: 'GZIP' },
  /** payload.value exactly as received (JSON string or number), pre-Number(). */
  value_raw: { type: 'UTF8', compression: 'GZIP' },
  /** Number(payload.value) — bit-for-bit what the live store serves strategies. */
  value: { type: 'DOUBLE', compression: 'GZIP' },
  received_at_ms: { type: 'INT64', compression: 'GZIP' },
})

const MAX_HOURS = 24 * 14

type Args = { assetId: string; hours?: number }

function parseArgs(argv: string[]): Args {
  let hours: number | undefined
  const { assetId } = parseCryptoPricesCliArgs({
    argv,
    usage: 'Usage: npm run telonex:crypto-prices:record-rtds -- --asset btcusd [--hours 30]',
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
  return { assetId, ...(hours !== undefined ? { hours } : {}) }
}

function hourKeyOf(ms: number): string {
  return `${utcDateOf(ms)}T${String(new Date(ms).getUTCHours()).padStart(2, '0')}`
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'crypto-prices:record' })
  const args = parseArgs(process.argv.slice(2))
  // btcusd → btc → btc/usd (the RTDS chainlink symbol spelling)
  const feedSymbol = chainlinkFeedSymbolForMarketSymbol(args.assetId.replace(/usd$/, ''))

  await fs.mkdir(recordingsDir(args.assetId), { recursive: true })
  const statusPath = recordingStatusPath(args.assetId)
  const logStatus = (event: Record<string, unknown>): void => {
    void fs
      .appendFile(statusPath, `${JSON.stringify({ ts_ms: Date.now(), ...event })}\n`)
      .catch((err) => console.warn('[crypto-prices:record] status append failed:', err))
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
      console.log(`[crypto-prices:record] closed ${target} rows=${rowsInHour}`)
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
      console.error('[crypto-prices:record] write failed:', err)
    })
  }

  let stopping = false
  let droppedAtShutdown = 0

  const appendTick = (m: {
    symbol: string
    payloadTimestampMs: number
    serverTimestampMs: number | null
    rawValue: unknown
    receivedAtMs: number
  }): void => {
    // WS frames already buffered when shutdown starts would otherwise enqueue
    // AFTER closeWriter, reopening a writer whose tmp file is abandoned when
    // process.exit fires (rows silently dropped into a stray .tmp). Counted
    // and reported so the verify gap analysis isn't left guessing.
    if (stopping) {
      droppedAtShutdown++
      return
    }
    const value = Number(m.rawValue)
    if (!Number.isFinite(value)) return // mirror of the live parse gate (asFiniteNumber)
    enqueue(async () => {
      const hourKey = hourKeyOf(m.receivedAtMs)
      if (!writer || hourKey !== writerHourKey) {
        await closeWriter()
        const date = hourKey.slice(0, 10)
        const hour = Number(hourKey.slice(11, 13))
        writerFinalPath = recordingHourPath(args.assetId, date, hour)
        writerTmpPath = `${writerFinalPath}.${process.pid}.tmp`
        writer = await parquet.ParquetWriter.openFile(
          recordedRtdsChainlinkParquetSchema,
          writerTmpPath,
        )
        writerHourKey = hourKey
        console.log(`[crypto-prices:record] opened ${writerFinalPath}`)
      }
      await writer.appendRow({
        symbol: m.symbol.toLowerCase(),
        ts_ms: BigInt(Math.trunc(m.payloadTimestampMs)),
        ...(m.serverTimestampMs !== null
          ? { server_ts_ms: BigInt(Math.trunc(m.serverTimestampMs)) }
          : {}),
        value_raw:
          typeof m.rawValue === 'string' ? m.rawValue : (JSON.stringify(m.rawValue) ?? 'undefined'),
        value,
        received_at_ms: BigInt(m.receivedAtMs),
      })
      rowsInHour++
      rowsTotal++
    })
  }

  const client = createRtdsCryptoPricesClient({
    binanceSymbols: [],
    chainlinkSymbols: [feedSymbol],
    onBinanceUpdate: () => {},
    onChainlinkUpdate: () => {},
    onChainlinkRaw: appendTick,
    onStatus: (s) => {
      console.log(
        `[crypto-prices:record] ws ${s.kind} attempt=${s.attempt}${s.info ? ` ${s.info}` : ''}`,
      )
      logStatus({ kind: s.kind, attempt: s.attempt, info: s.info })
    },
  })

  const shutdown = (reason: string): void => {
    if (stopping) return
    stopping = true
    console.log(`[crypto-prices:record] stopping (${reason}); draining writes...`)
    logStatus({ kind: 'recorder-stop', info: reason })
    client.stop()
    enqueue(closeWriter)
    void chain.then(async () => {
      if (droppedAtShutdown > 0) {
        console.warn(
          `[crypto-prices:record] ${droppedAtShutdown} buffered tick(s) discarded at shutdown (after recorder-stop)`,
        )
        // Awaited (unlike logStatus) so process.exit can't cut the append off.
        await fs
          .appendFile(
            statusPath,
            `${JSON.stringify({ ts_ms: Date.now(), kind: 'recorder-dropped-at-shutdown', count: droppedAtShutdown })}\n`,
          )
          .catch(() => {})
      }
      console.log(`[crypto-prices:record] done. total rows=${rowsTotal}`)
      process.exit(chainErr ? 1 : 0)
    })
  }

  installSignalHandlers({ onSignal: (sig) => shutdown(sig) })
  if (args.hours) {
    setTimeout(() => shutdown(`--hours ${args.hours} elapsed`), args.hours * 3_600_000)
  }

  const statsTimer = setInterval(() => {
    console.log(`[crypto-prices:record] rows total=${rowsTotal} current-hour=${rowsInHour}`)
  }, 60_000)
  statsTimer.unref()

  // Sleep/freeze detection: when the machine suspends, the process freezes
  // without any WS close event, so the status log would show nothing while
  // ticks silently go missing. A wall-clock jump on this 1s heartbeat marks
  // the frozen interval as an excusable gap for the verify CLI.
  let lastBeatMs = Date.now()
  const beatTimer = setInterval(() => {
    const now = Date.now()
    if (now - lastBeatMs > 10_000) {
      console.warn(
        `[crypto-prices:record] clock jump detected (${((now - lastBeatMs) / 1000).toFixed(0)}s) — machine slept?`,
      )
      logStatus({ kind: 'clock-jump', gap_from_ms: lastBeatMs, gap_to_ms: now })
    }
    lastBeatMs = now
  }, 1_000)
  beatTimer.unref()

  logStatus({ kind: 'recorder-start', info: `rtds crypto_prices_chainlink ${feedSymbol}` })
  console.log(
    `[crypto-prices:record] recording rtds chainlink ${feedSymbol} → ${recordingsDir(args.assetId)}`,
  )
  client.start()
}

main().catch((err) => {
  console.error('[crypto-prices:record] fatal:', err)
  process.exit(1)
})
