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

function WeakBadge(props: { weak: unknown }) {
  const w = fmtSide(props.weak)
  const cls =
    w === 'UP'
      ? 'bg-green-600/80 ring-green-500/30'
      : w === 'DOWN'
        ? 'bg-red-600/80 ring-red-500/30'
        : w === 'NONE'
          ? 'bg-zinc-700/60 ring-zinc-500/20'
          : 'bg-zinc-800/50 ring-zinc-500/20'
  return (
    <span
      className={`inline-flex min-w-[52px] justify-center items-center rounded-md px-2 py-0.5 text-[12px] font-semibold tracking-wide text-white ring-1 ${cls}`}
    >
      {w}
    </span>
  )
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

function MergedCompareTable(props: {
  askLevels: number
  bidLevels: number
  upAsks: BotUiOrderBookLevel[]
  downAsks: BotUiOrderBookLevel[]
  upBids: BotUiOrderBookLevel[]
  downBids: BotUiOrderBookLevel[]
  upAsksDepth: number[]
  downAsksDepth: number[]
  upBidsDepth: number[]
  downBidsDepth: number[]
  weakAskSideByLevel: ('UP' | 'DOWN' | 'NONE')[]
  weakAskRatioByLevel: number[]
  weakBidSideByLevel: ('UP' | 'DOWN' | 'NONE')[]
  weakBidRatioByLevel: number[]
  upSpread: number | undefined
  downSpread: number | undefined
}) {
  const askRows = Math.max(0, Math.floor(props.askLevels))
  const bidRows = Math.max(0, Math.floor(props.bidLevels))
  const rowsTotal = askRows + bidRows

  if (rowsTotal === 0) return <div className="text-[14px] text-zinc-400">no data</div>

  const thBase = 'sticky top-0 bg-zinc-900/60 px-2 py-1.5 text-zinc-400'
  const tdBase = 'px-2 py-1.5 whitespace-nowrap'

  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-md bg-zinc-900/35 ring-1 ring-zinc-700/60 w-full max-w-max">
      <table className="w-max table-fixed border-separate border-spacing-0 text-[14px]">
        <colgroup>
          <col className="w-[52px]" />
          <col className="w-[88px]" />
          <col className="w-[72px]" />
          <col className="w-[100px]" />
          <col className="w-[72px]" />
          <col className="w-[86px]" />
          <col className="w-[100px]" />
          <col className="w-[72px]" />
          <col className="w-[88px]" />
        </colgroup>

        <thead>
          <tr className="text-left">
            <th className={thBase}>lvl</th>
            <th className={`${thBase} text-right`}>UP sz</th>
            <th className={thBase}>UP px</th>
            <th className={thBase}>UP depth</th>
            <th className={thBase}>weak</th>
            <th className={thBase}>ratio</th>
            <th className={thBase}>DOWN depth</th>
            <th className={thBase}>DOWN px</th>
            <th className={`${thBase} text-right`}>DOWN sz</th>
          </tr>
        </thead>

        <tbody className="font-mono text-zinc-200">
          {/* ASKS section (deepest -> closest) */}
          {Array.from({ length: askRows }).map((_, i) => {
            const idx = askRows - 1 - i
            const up = props.upAsks[idx]
            const down = props.downAsks[idx]
            const pxClass = 'text-red-300'
            return (
              <tr key={`ask-${i}`} className="border-t border-zinc-800/60">
                <td className={`${tdBase} tabular-nums`}>{idx + 1}</td>
                <td className={`${tdBase} text-right tabular-nums`}>{up ? fmtSize(up.size) : '—'}</td>
                <td className={`${tdBase} tabular-nums ${pxClass}`}>{up ? fmtCents(up.price, { fixed: true, digits: 2 }) : '—'}</td>
                <td className={`${tdBase} text-right tabular-nums text-emerald-300`}>{fmtDepth(props.upAsksDepth[idx])}</td>
                <td className={tdBase}>
                  <WeakBadge weak={props.weakAskSideByLevel[idx]} />
                </td>
                <td className={`${tdBase} tabular-nums`}>{fmtRatio(props.weakAskRatioByLevel[idx])}</td>
                <td className={`${tdBase} text-right tabular-nums text-red-300`}>{fmtDepth(props.downAsksDepth[idx])}</td>
                <td className={`${tdBase} tabular-nums ${pxClass}`}>
                  {down ? fmtCents(down.price, { fixed: true, digits: 2 }) : '—'}
                </td>
                <td className={`${tdBase} text-right tabular-nums`}>{down ? fmtSize(down.size) : '—'}</td>
              </tr>
            )
          })}

          {/* Spread separator row */}
          <tr className="border-t border-zinc-800/60">
            <td colSpan={9} className="px-2 py-2">
              <div className="flex items-center justify-between gap-4 rounded-md bg-zinc-900/30 ring-1 ring-zinc-800 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="text-[12px] text-zinc-400">UP spread</div>
                  <div className="font-mono text-[14px] tabular-nums text-zinc-200">
                    {fmtCents(props.upSpread, { fixed: true, digits: 2 })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[12px] text-zinc-400">DOWN spread</div>
                  <div className="font-mono text-[14px] tabular-nums text-zinc-200">
                    {fmtCents(props.downSpread, { fixed: true, digits: 2 })}
                  </div>
                </div>
              </div>
            </td>
          </tr>

          {/* BIDS section (level 1 -> deeper) */}
          {Array.from({ length: bidRows }).map((_, i) => {
            const idx = i
            const up = props.upBids[idx]
            const down = props.downBids[idx]
            const pxClass = 'text-emerald-300'
            return (
              <tr key={`bid-${i}`} className="border-t border-zinc-800/60">
                <td className={`${tdBase} tabular-nums`}>{idx + 1}</td>
                <td className={`${tdBase} text-right tabular-nums`}>{up ? fmtSize(up.size) : '—'}</td>
                <td className={`${tdBase} tabular-nums ${pxClass}`}>{up ? fmtCents(up.price, { fixed: true, digits: 2 }) : '—'}</td>
                <td className={`${tdBase} text-right tabular-nums text-emerald-300`}>{fmtDepth(props.upBidsDepth[idx])}</td>
                <td className={tdBase}>
                  <WeakBadge weak={props.weakBidSideByLevel[idx]} />
                </td>
                <td className={`${tdBase} tabular-nums`}>{fmtRatio(props.weakBidRatioByLevel[idx])}</td>
                <td className={`${tdBase} text-right tabular-nums text-red-300`}>{fmtDepth(props.downBidsDepth[idx])}</td>
                <td className={`${tdBase} tabular-nums ${pxClass}`}>
                  {down ? fmtCents(down.price, { fixed: true, digits: 2 }) : '—'}
                </td>
                <td className={`${tdBase} text-right tabular-nums`}>{down ? fmtSize(down.size) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
        <div className="text-[12px] font-mono text-zinc-500">
          {askLevels > 0 || bidLevels > 0 ? `asks ${askLevels} | bids ${bidLevels}` : 'n/a'}
        </div>
      </div>

      <MergedCompareTable
        askLevels={askLevels}
        bidLevels={bidLevels}
        upAsks={upAsks}
        downAsks={downAsks}
        upBids={upBids}
        downBids={downBids}
        upAsksDepth={upAsksDepth}
        downAsksDepth={downAsksDepth}
        upBidsDepth={upBidsDepth}
        downBidsDepth={downBidsDepth}
        weakAskSideByLevel={om?.weakAskSideByLevel ?? []}
        weakAskRatioByLevel={om?.weakAskRatioByLevel ?? []}
        weakBidSideByLevel={om?.weakBidSideByLevel ?? []}
        weakBidRatioByLevel={om?.weakBidRatioByLevel ?? []}
        upSpread={upSpread}
        downSpread={downSpread}
      />
    </div>
  )
}


