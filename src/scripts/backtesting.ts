import { createParquetReplaySource } from '../backtest/parquetReplaySource.js'
import { createMarketEventHandler } from '../engine/marketEventHandler.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'

installProcessCrashHandlers({ prefix: 'backtesting' })

function parseOrderValue(raw: string | undefined): 'recorded' | 'exchange_time' {
  if (raw === 'recorded' || raw === 'exchange_time') return raw
  return 'recorded'
}

function parseArgs(argv: string[]): {
  filePaths: string[]
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
} {
  const filePaths: string[] = []
  let order: 'recorded' | 'exchange_time' = 'recorded'
  let timeDriven = false

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    if (a === '--order') {
      order = parseOrderValue(argv[i + 1])
      i += 1 // consume value
      continue
    }
    if (a === '--time-driven' || a === '--realtime') {
      timeDriven = true
      continue
    }
    if (a.startsWith('-')) {
      // Unknown flag: ignore for now.
      continue
    }

    filePaths.push(a)
  }

  return { filePaths, order, timeDriven }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)
  const filePaths = parsed.filePaths
  if (filePaths.length === 0) {
    console.error(
      'Usage: tsx src/scripts/backtesting.ts <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]',
    )
    process.exit(2)
  }

  const order = parsed.order
  const timeDriven = parsed.timeDriven

  console.log(`[backtesting] files=${filePaths.length}`)
  console.log(`[backtesting] order=${order}`)
  console.log(`[backtesting] timeDriven=${timeDriven}`)

  const handler = createMarketEventHandler()

  let doneResolve: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    doneResolve = resolve
  })

  const source = createParquetReplaySource({ filePaths, order, timeDriven })

  source.onEvent((ev) => {
    handler.handle(ev)
  })

  source.onStatus((s) => {
    if (s.kind === 'connected') {
      console.log(`[backtesting] started (${s.info ?? 'parquet'})`)
      return
    }
    if (s.kind === 'disconnected') {
      console.log(`[backtesting] finished (${s.info ?? 'done'})`)
      doneResolve?.()
      return
    }
    if (s.kind === 'reconnecting') {
      // replay source doesn't reconnect, but keep this for interface parity
      console.log(`[backtesting] reconnecting in ${s.delayMs}ms (${s.info ?? ''})`)
    }
  })

  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[backtesting] ${signal} received, stopping...`)
    source.stop()
  }
  installSignalHandlers({ onSignal: shutdown })

  source.start()
  await done

  const snap = handler.snapshot()
  console.log('[backtesting] summary', snap)
}

main().catch((err) => {
  console.error('[backtesting] failed', err)
  process.exit(1)
})
