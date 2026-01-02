import { ConnectionBadge } from './components/ConnectionBadge'
import { LogsPanel } from './components/LogsPanel'
import { OrderbookPanel } from './components/OrderbookPanel'
import { useBotWs } from './hooks/useBotWs'

function bestAskFromBook(book?: { bestAsk?: number }): number | null {
  const a = book?.bestAsk
  if (typeof a !== 'number' || !Number.isFinite(a)) return null
  return a
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

export function App() {
  const { status, snapshot, logLines, logRecords } = useBotWs()
  const upAsk = snapshot ? bestAskFromBook(snapshot.books.up) : null
  const downAsk = snapshot ? bestAskFromBook(snapshot.books.down) : null

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-2 px-2 py-2">
          <div className="flex min-w-[260px] items-center gap-2">
            <div className="text-sm font-semibold text-zinc-100">polymarket-bot</div>
            <ConnectionBadge status={status} />
            {snapshot ? (
              <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                candle left <span className="ml-1 font-mono">{fmtMs(snapshot.status.candleLeftMs)}</span>
              </span>
            ) : null}
          </div>

          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-baseline gap-3 rounded-md bg-zinc-900/40 px-2 py-1 ring-1 ring-zinc-800">
              <div className="flex items-baseline gap-1 font-mono text-[16px]">
                <span className="text-zinc-500">UP</span>
                <span className="text-cyan-200">{upAsk === null ? 'n/a' : upAsk.toFixed(4)}</span>
              </div>
              <span className="text-zinc-700">|</span>
              <div className="flex items-baseline gap-1 font-mono text-[16px]">
                <span className="text-zinc-500">DOWN</span>
                <span className="text-fuchsia-200">{downAsk === null ? 'n/a' : downAsk.toFixed(4)}</span>
              </div>
            </div>
          </div>

          <div className="flex min-w-[360px] items-center justify-end gap-2">
            {snapshot ? (
              <>
                <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                  slug <span className="ml-1 font-mono">{snapshot.status.slug ?? 'n/a'}</span>
                </span>
                <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                  ws attempt <span className="ml-1 font-mono">{snapshot.status.wsAttempt}</span>
                </span>
                <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                  ws events <span className="ml-1 font-mono">{snapshot.status.wsEventsTotal}</span>
                </span>
              </>
            ) : (
              <div className="text-[14px] text-zinc-500">webui</div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-2 py-2 pb-16">
        {!snapshot ? (
          <div className="panel panel-b text-zinc-300">waiting for snapshot…</div>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-[420px_1fr_520px]">
            {/* LEFT COLUMN */}
            <div className="space-y-2">

              <div className="panel">
                <div className="panel-h">
                  <div className="panel-t">Portfolio</div>
                  <div className="text-[14px] text-zinc-500">coming next</div>
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
                  <div className="text-[14px] text-zinc-500">coming next</div>
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
                  <div className="text-[14px] text-zinc-500">coming next</div>
                </div>
                <div className="panel-b text-[16px] text-zinc-400">n/a</div>
              </div>

              <LogsPanel logLines={logLines} logRecords={logRecords} />
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-10 border-t border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2 px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              bot <span className="ml-1 font-mono">{snapshot?.title ?? 'n/a'}</span>
            </span>
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              strategy <span className="ml-1 font-mono">n/a</span>
            </span>
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              params <span className="ml-1 font-mono">n/a</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              indicators <span className="ml-1 font-mono">n/a</span>
            </span>
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              external feeds <span className="ml-1 font-mono">n/a</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}


