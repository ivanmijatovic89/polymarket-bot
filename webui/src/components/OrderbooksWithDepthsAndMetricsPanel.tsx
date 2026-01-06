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

function SideTable(props: { rows: BotUiOrderBookLevel[]; side: 'ask' | 'bid'; levels: number }) {
  const { rows, side, levels } = props
  const padded: Array<BotUiOrderBookLevel | null> = (() => {
    // Keep best levels closest to the spread:
    // - asks: best ask at the bottom -> pad missing rows at the TOP
    // - bids: best bid at the top -> pad missing rows at the BOTTOM
    // IMPORTANT: `book.asks` is already sorted ASC with best ask first.
    // We must slice FIRST (take best levels) and only then reverse for display (best ask at bottom).
    const baseRaw: Array<BotUiOrderBookLevel | null> = rows.slice(0, levels)
    const base: Array<BotUiOrderBookLevel | null> = side === 'ask' ? baseRaw.slice().reverse() : baseRaw
    while (base.length < levels) {
      if (side === 'ask') base.unshift(null)
      else base.push(null)
    }
    return base.slice(0, levels)
  })()

  return (
    <div className="rounded-md bg-zinc-900/60 ring-1 ring-zinc-800">
      <div className="font-mono text-[18px]">
        {padded.map((r, idx) => (
          <div key={idx} className="grid grid-cols-2 gap-2 px-2 py-0.5">
            <div className={side === 'ask' ? 'text-red-300' : 'text-emerald-300'}>
              {r ? fmtCents(r.price, { fixed: true, digits: 2 }) : <span className="text-zinc-600">—</span>}
            </div>
            <div className="text-right text-zinc-200">
              {r ? fmtSize(r.size) : <span className="text-zinc-600">—</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OneBookHeader(props: { label: 'UP' | 'DOWN'; book?: BotUiOrderBook }) {
  const book = props.book
  const bb = fmtCents(book?.bestBid, { fixed: true, digits: 2 })
  const ba = fmtCents(book?.bestAsk, { fixed: true, digits: 2 })
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <div className="text-[18px] font-semibold">{props.label}</div>
      <div className="flex items-center gap-2 font-mono text-[18px] text-zinc-300">
        <span className="text-red-300">ask {ba}</span>
        <span className="text-zinc-500">/</span>
        <span className="text-emerald-300">bid {bb}</span>
      </div>
    </div>
  )
}

function MidDepthMetricsTable(props: {
  title: string
  levels: number
  upDepthByLevel: number[]
  downDepthByLevel: number[]
  weakSideByLevel: ('UP' | 'DOWN' | 'NONE')[]
  weakRatioByLevel: number[]
}) {
  const rows = Math.max(0, Math.floor(props.levels))
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
              <col className="w-[64px]" />
              <col className="w-[160px]" />
              <col className="w-[160px]" />
              <col className="w-[100px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead>
              <tr className="text-left text-zinc-400">
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">lvl</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">upDepth</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">downDepth</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">side</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">ratio</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-200">
              {Array.from({ length: rows }).map((_, i) => (
                <tr key={i} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1.5 whitespace-nowrap">{i + 1}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-emerald-300">{fmtDepth(props.upDepthByLevel[i])}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-red-300">{fmtDepth(props.downDepthByLevel[i])}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtSide(props.weakSideByLevel[i])}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtRatio(props.weakRatioByLevel[i])}</td>
                </tr>
              ))}
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

  // Note: asks/bids arrays are already sliced server-side by WEB_UI_ORDERBOOK_LEVELS.
  // NOTE: do not reverse here; `SideTable` handles ask rendering.
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

      {/* ASKS: UP | (depths + weakAsk) | DOWN */}
      <div className="grid grid-cols-1 gap-2 min-w-0 xl:grid-cols-3">
        <div className="min-w-0">
          <OneBookHeader label="UP" book={up} />
          <SideTable rows={upAsks} side="ask" levels={askLevels} />
        </div>

        <div className="min-w-0">
          <MidDepthMetricsTable
            title="asksDepth + weakAsk"
            levels={askLevels}
            upDepthByLevel={upAsksDepth}
            downDepthByLevel={downAsksDepth}
            weakSideByLevel={om?.weakAskSideByLevel ?? []}
            weakRatioByLevel={om?.weakAskRatioByLevel ?? []}
          />
        </div>

        <div className="min-w-0">
          <OneBookHeader label="DOWN" book={down} />
          <SideTable rows={downAsks} side="ask" levels={askLevels} />
        </div>
      </div>

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

      {/* BIDS: UP | (depths + weakBid) | DOWN */}
      <div className="mt-2 grid grid-cols-1 gap-2 min-w-0 xl:grid-cols-3">
        <div className="min-w-0">
          <SideTable rows={upBids} side="bid" levels={bidLevels} />
        </div>

        <div className="min-w-0">
          <MidDepthMetricsTable
            title="bidsDepth + weakBid"
            levels={bidLevels}
            upDepthByLevel={upBidsDepth}
            downDepthByLevel={downBidsDepth}
            weakSideByLevel={om?.weakBidSideByLevel ?? []}
            weakRatioByLevel={om?.weakBidRatioByLevel ?? []}
          />
        </div>

        <div className="min-w-0">
          <SideTable rows={downBids} side="bid" levels={bidLevels} />
        </div>
      </div>
    </div>
  )
}


