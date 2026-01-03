import { ConnectionBadge } from './components/ConnectionBadge'
import { ExternalFeedsPanel } from './components/ExternalFeedsPanel'
import { LogsPanel } from './components/LogsPanel'
import { OrderbooksPanel } from './components/OrderbooksPanel'
import { ExecutedOrdersTablePanel, OpenOrdersTablePanel, PositionsTablePanel } from './components/PortfolioPanels'
import { VolatilityPanel } from './components/VolatilityPanel'
import { useBotWs } from './hooks/useBotWs'
import { fmtCents } from './utils/format'

function bestAskFromBook(book?: { bestAsk?: number }): number | null {
  const a = book?.bestAsk
  if (typeof a !== 'number' || !Number.isFinite(a)) return null
  return a
}

function fmtShortJson(x: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(x)
    if (!s) return 'n/a'
    if (s.length <= maxLen) return s
    return `${s.slice(0, Math.max(0, maxLen - 1))}…`
  } catch {
    return 'n/a'
  }
}

function fmtList(xs: string[] | undefined, emptyLabel = 'none'): string {
  if (!xs || xs.length === 0) return emptyLabel
  return xs.join(', ')
}

function feedKeysFromData(snapshot: unknown): string[] {
  const s = snapshot as any
  const feeds = s?.feeds
  const out: string[] = []
  if (feeds?.rtdsPolymarketCryptoPrices?.binance) out.push('rtds:binance')
  if (feeds?.rtdsPolymarketCryptoPrices?.chainlink) out.push('rtds:chainlink')
  if (feeds?.binanceWsSpotPrice) out.push('binance_ws')
  if (feeds?.polymarketPriceToBeat) out.push('price_to_beat')
  return out
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

export function App() {
  const { status, snapshot, logLines } = useBotWs()
  const upAsk = snapshot ? bestAskFromBook(snapshot.books.up) : null
  const downAsk = snapshot ? bestAskFromBook(snapshot.books.down) : null
  const strategy = snapshot?.strategy
  const indEnabled = snapshot?.strategy?.indicators ?? []
  const feedsDataKeys = snapshot ? feedKeysFromData(snapshot) : []
  const hasVolatility = Boolean((snapshot as any)?.indicators?.volatility)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800  backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2 px-2 py-2">
          <div className="flex min-w-0 items-center gap-2 md:min-w-[260px]">
            <div className="text-sm font-semibold text-zinc-100">polymarket-bot</div>
            <ConnectionBadge status={status} />
            {snapshot ? (
              <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                ⏳ <span className="ml-1 font-mono">{fmtMs(snapshot.status.candleLeftMs)}</span>
              </span>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-center">
              <div className="flex  bg-green-500 font-mono text-[22px] text-white px-10 py-3 rounded-md rounded-r-none ">
                <span className="text-white">{fmtCents(upAsk, { fixed: true, digits: 2 })} ¢</span>
              </div>
              <div className="flex  bg-red-500 font-mono text-[22px] text-white px-10 py-3 rounded-md rounded-l-none ">
                <span className="text-white">{fmtCents(downAsk, { fixed: true, digits: 2 })} ¢</span>
              </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 md:min-w-[360px]">
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

      <main className="mx-auto  px-2 py-2 pb-16">
        {!snapshot ? (
          <div className="panel panel-b text-zinc-300">waiting for snapshot…</div>
        ) : (
          <div className="space-y-2">
            {/* Full-width row under header */}
            <ExternalFeedsPanel snapshot={snapshot} />

            {/* Full-width: portfolio + orders */}
            <div className="space-y-2">
              <PositionsTablePanel snapshot={snapshot} />
              <OpenOrdersTablePanel snapshot={snapshot} />
              <ExecutedOrdersTablePanel snapshot={snapshot} />
            </div>


            <div className="space-y-2">
            <LogsPanel logLines={logLines} />
            </div>

            {/* Row below: orderbooks + logs */}
            <div
              className={`grid grid-cols-1 gap-2 ${
                hasVolatility ? 'xl:grid-cols-[420px_1fr]' : 'xl:grid-cols-[420px_1fr]'
              }`}
            >
              <div className="space-y-2 min-w-0">
                <OrderbooksPanel up={snapshot.books.up} down={snapshot.books.down} />
              </div>
              {hasVolatility ? (
                <div className="space-y-2 min-w-0">
                  <VolatilityPanel snapshot={snapshot} />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-10 border-t border-zinc-800  backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2 px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              <span className="ml-1 font-mono">{strategy?.id ?? 'n/a'}</span>
            </span>
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              <span className="ml-1 font-mono">{fmtShortJson(strategy?.params ?? null, 80)}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              indicators <span className="ml-1 font-mono">{fmtList(indEnabled)}</span>
            </span>
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              external feeds <span className="ml-1 font-mono">{fmtList(feedsDataKeys)}</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}


