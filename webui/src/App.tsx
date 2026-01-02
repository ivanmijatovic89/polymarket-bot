import { ConnectionBadge } from './components/ConnectionBadge'
import { LogsPanel } from './components/LogsPanel'
import { OrderbookPanel } from './components/OrderbookPanel'
import { StatusBar } from './components/StatusBar'
import { useBotWs } from './hooks/useBotWs'

export function App() {
  const { status, snapshot, logLines, logRecords } = useBotWs()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-zinc-100">polymarket-bot</div>
            <ConnectionBadge status={status} />
          </div>
          <div className="text-xs text-zinc-500">Phase 1 read-only</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        {!snapshot ? (
          <div className="rounded-lg bg-zinc-950/40 p-4 text-zinc-300 ring-1 ring-zinc-800">
            waiting for snapshot…
          </div>
        ) : (
          <div className="space-y-4">
            <StatusBar snapshot={snapshot} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <OrderbookPanel label="UP" book={snapshot.books.up} />
              <OrderbookPanel label="DOWN" book={snapshot.books.down} />
            </div>

            <LogsPanel logLines={logLines} logRecords={logRecords} />
          </div>
        )}
      </main>
    </div>
  )
}


