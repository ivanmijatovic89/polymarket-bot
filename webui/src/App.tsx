import { ConnectionBadge } from './components/ConnectionBadge'
import { LogsPanel } from './components/LogsPanel'
import { OrderbookPanel } from './components/OrderbookPanel'
import { StatusBar } from './components/StatusBar'
import { useBotWs } from './hooks/useBotWs'

function midFromBook(book?: { bestBid?: number; bestAsk?: number }): number | null {
  const b = book?.bestBid
  const a = book?.bestAsk
  if (typeof b !== 'number' || !Number.isFinite(b)) return null
  if (typeof a !== 'number' || !Number.isFinite(a)) return null
  return (a + b) / 2
}

export function App() {
  const { status, snapshot, logLines, logRecords } = useBotWs()
  const upMid = snapshot ? midFromBook(snapshot.books.up) : null
  const downMid = snapshot ? midFromBook(snapshot.books.down) : null

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-2 px-2 py-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-zinc-100">polymarket-bot</div>
            <ConnectionBadge status={status} />
          </div>
          <div className="text-[11px] text-zinc-500">webui</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-2 py-2">
        {!snapshot ? (
          <div className="panel panel-b text-zinc-300">waiting for snapshot…</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[420px_1fr_520px]">
            {/* LEFT COLUMN */}
            <div className="space-y-2">
              <StatusBar snapshot={snapshot} />

              <div className="panel">
                <div className="panel-h">
                  <div className="panel-t">Market</div>
                  <div className="text-[11px] text-zinc-500">current</div>
                </div>
                <div className="panel-b kv">
                  <div className="k">UP mid</div>
                  <div className="v">{upMid === null ? 'n/a' : upMid.toFixed(4)}</div>
                  <div className="k">DOWN mid</div>
                  <div className="v">{downMid === null ? 'n/a' : downMid.toFixed(4)}</div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <div className="panel-t">Strategy</div>
                  <div className="text-[11px] text-zinc-500">coming next</div>
                </div>
                <div className="panel-b kv">
                  <div className="k">name</div>
                  <div className="v">n/a</div>
                  <div className="k">params</div>
                  <div className="v">n/a</div>
                  <div className="k">indicators</div>
                  <div className="v">n/a</div>
                  <div className="k">external feeds</div>
                  <div className="v">n/a</div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <div className="panel-t">Portfolio</div>
                  <div className="text-[11px] text-zinc-500">coming next</div>
                </div>
                <div className="panel-b kv">
                  <div className="k">UP</div>
                  <div className="v">n/a</div>
                  <div className="k">DOWN</div>
                  <div className="v">n/a</div>
                  <div className="k">avg UP</div>
                  <div className="v">n/a</div>
                  <div className="k">avg DOWN</div>
                  <div className="v">n/a</div>
                  <div className="k">mergeable</div>
                  <div className="v">n/a</div>
                  <div className="k">PnL</div>
                  <div className="v">n/a</div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-h">
                  <div className="panel-t">Balances</div>
                  <div className="text-[11px] text-zinc-500">coming next</div>
                </div>
                <div className="panel-b kv">
                  <div className="k">wallet</div>
                  <div className="v">n/a</div>
                </div>
              </div>
            </div>

            {/* MIDDLE COLUMN */}
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                <OrderbookPanel label="UP" book={snapshot.books.up} />
                <OrderbookPanel label="DOWN" book={snapshot.books.down} />
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="space-y-2">
              <div className="panel">
                <div className="panel-h">
                  <div className="panel-t">Open orders</div>
                  <div className="text-[11px] text-zinc-500">coming next</div>
                </div>
                <div className="panel-b text-[12px] text-zinc-400">n/a</div>
              </div>

              <LogsPanel logLines={logLines} logRecords={logRecords} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}


