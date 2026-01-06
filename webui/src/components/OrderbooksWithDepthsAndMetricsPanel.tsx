import type { BotUiOrderBook, BotUiOrderBookLevel, BotUiSnapshot } from '../types'
import { fmtCents } from '../utils/format'

type OrderbookMetrics = {
  depthLevels: number
  weakBidSideByLevel: ('UP' | 'DOWN' | 'NONE')[]
  weakBidRatioByLevel: number[]
  weakAskSideByLevel: ('UP' | 'DOWN' | 'NONE')[]
  weakAskRatioByLevel: number[]
}

function asOrderbookMetrics(snapshot: BotUiSnapshot): OrderbookMetrics | null {
  const m = (snapshot as any)?.metrics?.orderbook
  if (!m || typeof m !== 'object') return null
  if (typeof m.depthLevels !== 'number') return null
  if (!Array.isArray(m.weakBidSideByLevel)) return null
  if (!Array.isArray(m.weakBidRatioByLevel)) return null
  if (!Array.isArray(m.weakAskSideByLevel)) return null
  if (!Array.isArray(m.weakAskRatioByLevel)) return null
  return m as OrderbookMetrics
}

function fmtSize(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function fmtDepth(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function fmtRatio(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
  return x.toFixed(4)
}

function fmtSide(x: unknown): string {
  return x === 'UP' || x === 'DOWN' || x === 'NONE' ? x : '—'
}

function spreadFromBook(book?: BotUiOrderBook): number | undefined {
  if (
    typeof book?.bestBid === 'number' &&
    Number.isFinite(book.bestBid) &&
    typeof book?.bestAsk === 'number' &&
    Number.isFinite(book.bestAsk)
  ) {
    return book.bestAsk - book.bestBid
  }
  return undefined
}

function MergedSideCompareTable(props: {
  title: string
  side: 'ask' | 'bid'
  levels: number
  upRows: BotUiOrderBookLevel[]
  downRows: BotUiOrderBookLevel[]
  upDepthByLevel: number[]
  downDepthByLevel: number[]
  weakSideByLevel: ('UP' | 'DOWN' | 'NONE')[]
  weakRatioByLevel: number[]
}) {
  const rows = Math.max(0, Math.floor(props.levels))
  const sideLabel = props.side === 'ask' ? 'ask' : 'bid'

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[18px] font-semibold text-zinc-200">{props.title}</div>
        <div className="text-[12px] font-mono text-zinc-500">{rows > 0 ? `levels ${rows}` : 'n/a'}</div>
      </div>

      {rows === 0 ? (
        <div className="text-[14px] text-zinc-400">no data</div>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain rounded-md bg-zinc-900/40 ring-1 ring-zinc-800">
          <table className="w-full table-fixed border-separate border-spacing-0 text-[16px]">
            <colgroup>
              <col className="w-[56px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[90px]" />
              <col className="w-[120px]" />
              <col className="w-[90px]" />
            </colgroup>

            <thead>
              <tr className="text-left text-zinc-400">
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">lvl</th>

                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">UP px</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">UP sz</th>

                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">DOWN px</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">DOWN sz</th>

                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">UP depth</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">DOWN depth</th>

                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">weak</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">ratio</th>

                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">side</th>
              </tr>
            </thead>

            <tbody className="font-mono text-zinc-200">
              {Array.from({ length: rows }).map((_, i) => {
                const up = props.upRows[i]
                const down = props.downRows[i]
                const pxClass = props.side === 'ask' ? 'text-red-300' : 'text-emerald-300'
                return (
                  <tr key={i} className="border-t border-zinc-800/60">
                    <td className="px-2 py-1.5 whitespace-nowrap">{i + 1}</td>

                    <td className={`px-2 py-1.5 whitespace-nowrap ${pxClass}`}>
                      {up ? fmtCents(up.price, { fixed: true, digits: 2 }) : '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-right">{up ? fmtSize(up.size) : '—'}</td>

                    <td className={`px-2 py-1.5 whitespace-nowrap ${pxClass}`}>
                      {down ? fmtCents(down.price, { fixed: true, digits: 2 }) : '—'}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-right">{down ? fmtSize(down.size) : '—'}</td>

                    <td className="px-2 py-1.5 whitespace-nowrap text-right">{fmtDepth(props.upDepthByLevel[i])}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-right">{fmtDepth(props.downDepthByLevel[i])}</td>

                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtSide(props.weakSideByLevel[i])}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtRatio(props.weakRatioByLevel[i])}</td>

                    <td className="px-2 py-1.5 whitespace-nowrap text-zinc-500">{sideLabel}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function OrderbooksWithDepthsAndMetricsPanel(props: {
  snapshot: BotUiSnapshot
  up?: BotUiOrderBook
  down?: BotUiOrderBook
}) {
  const up = props.up
  const down = props.down
  const om = asOrderbookMetrics(props.snapshot)

  // Keep arrays in level order for alignment with depth arrays:
  // - asks: ASC (best ask first)
  // - bids: DESC (best bid first)
  const upAsks = up?.asks ?? []
  const downAsks = down?.asks ?? []
  const upBids = up?.bids ?? []
  const downBids = down?.bids ?? []

  const askLevels = Math.max(upAsks.length, downAsks.length)
  const bidLevels = Math.max(upBids.length, downBids.length)

  const upSpread = spreadFromBook(up)
  const downSpread = spreadFromBook(down)

  const upBidsDepth = up?.bidsDepthByLevel ?? []
  const downBidsDepth = down?.bidsDepthByLevel ?? []
  const upAsksDepth = up?.asksDepthByLevel ?? []
  const downAsksDepth = down?.asksDepthByLevel ?? []

  return (
    <div className="panel p-2.5 min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[18px] font-semibold text-zinc-200">orderbooks + depths + metrics (compare)</div>
      </div>

      <MergedSideCompareTable
        title="ASKS: UP vs DOWN (+ depths + weakAsk)"
        side="ask"
        levels={askLevels}
        upRows={upAsks}
        downRows={downAsks}
        upDepthByLevel={upAsksDepth}
        downDepthByLevel={downAsksDepth}
        weakSideByLevel={om?.weakAskSideByLevel ?? []}
        weakRatioByLevel={om?.weakAskRatioByLevel ?? []}
      />

      {/* SPREAD ROW */}
      <div className="mt-2 grid grid-cols-1 gap-2 min-w-0 xl:grid-cols-3">
        <div className="rounded-md bg-zinc-900/40 px-2 py-1.5 ring-1 ring-zinc-800">
          <div className="flex items-center justify-between gap-2 text-[18px]">
            <div className="text-zinc-400">UP spread</div>
            <div className="font-mono text-zinc-200">{fmtCents(upSpread, { fixed: true, digits: 2 })}</div>
          </div>
        </div>

        <div className="rounded-md bg-zinc-900/20 px-2 py-1.5 ring-1 ring-zinc-800">
          <div className="text-[14px] text-zinc-500">—</div>
        </div>

        <div className="rounded-md bg-zinc-900/40 px-2 py-1.5 ring-1 ring-zinc-800">
          <div className="flex items-center justify-between gap-2 text-[18px]">
            <div className="text-zinc-400">DOWN spread</div>
            <div className="font-mono text-zinc-200">{fmtCents(downSpread, { fixed: true, digits: 2 })}</div>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <MergedSideCompareTable
          title="BIDS: UP vs DOWN (+ depths + weakBid)"
          side="bid"
          levels={bidLevels}
          upRows={upBids}
          downRows={downBids}
          upDepthByLevel={upBidsDepth}
          downDepthByLevel={downBidsDepth}
          weakSideByLevel={om?.weakBidSideByLevel ?? []}
          weakRatioByLevel={om?.weakBidRatioByLevel ?? []}
        />
      </div>
    </div>
  )
}


