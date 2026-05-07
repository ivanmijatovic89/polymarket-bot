import type { BotUiOrderBook, BotUiOrderBookLevel } from '../types'
import { fmtCents } from '../utils/format'

function fmtSize(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toFixed(3)
}

function SideTable(props: {
  title: 'ASK' | 'BID'
  rows: BotUiOrderBookLevel[]
  side: 'ask' | 'bid'
}) {
  const { title, rows, side } = props

  return (
    <div>
      <div className="rounded-md bg-zinc-900/60 ring-1 ring-zinc-800">
        <div className="font-mono text-[14px]">
          {rows.length === 0 ? (
            <div className="px-2 py-1.5 text-[14px] text-zinc-500">n/a</div>
          ) : (
            rows.map((r, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2 px-2 py-0.5">
                <div className={side === 'ask' ? 'text-red-300' : 'text-emerald-300'}>
                  {fmtCents(r.price)}
                </div>
                <div className="text-right text-zinc-200">{fmtSize(r.size)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export function OrderbookPanel(props: {
  label: 'UP' | 'DOWN'
  book?: BotUiOrderBook
  compact?: boolean
}) {
  const book = props.book
  const compact = Boolean(props.compact)
  const bb = fmtCents(book?.bestBid)
  const ba = fmtCents(book?.bestAsk)
  const spread =
    typeof book?.bestBid === 'number' &&
    Number.isFinite(book.bestBid) &&
    typeof book?.bestAsk === 'number' &&
    Number.isFinite(book.bestAsk)
      ? book.bestAsk - book.bestBid
      : undefined

  // For readability: keep best ask closest to spread (bottom of asks),
  // and best bid closest to spread (top of bids).
  // NOTE: `book.asks` is sorted ASC with best ask first; the backend already slices to WEB_UI_ORDERBOOK_LEVELS.
  // Reverse only for display so best ask ends up closest to the spread (bottom).
  const asksForView = (book?.asks ?? []).slice().reverse()
  const bidsForView = book?.bids ?? []

  return (
    <div className={`panel ${compact ? 'p-2.5' : 'p-3'}`}>
      <div className={`flex items-center justify-between gap-2 ${compact ? 'mb-1.5' : 'mb-2'}`}>
        <div className={`${compact ? 'text-[15px]' : 'text-[17px]'} font-semibold`}>
          {props.label}
        </div>
        <div
          className={`flex items-center gap-2 font-mono ${compact ? 'text-[14px]' : 'text-[16px]'} text-zinc-300`}
        >
          <span className="text-red-300">ask {ba}</span>
          <span className="text-zinc-500">/</span>
          <span className="text-emerald-300">bid {bb}</span>
        </div>
      </div>

      {book ? (
        <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
          <SideTable title="ASK" rows={asksForView} side="ask" />

          <div
            className={`rounded-md bg-zinc-900/40 ring-1 ring-zinc-800 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
          >
            <div
              className={`flex items-center justify-between gap-2 ${compact ? 'text-[14px]' : 'text-[16px]'}`}
            >
              <div className="text-zinc-400">spread</div>
              <div className="font-mono text-zinc-200">{fmtCents(spread)}</div>
            </div>
          </div>

          <SideTable title="BID" rows={bidsForView} side="bid" />
        </div>
      ) : (
        <div className="text-[16px] text-zinc-400">no data</div>
      )}
    </div>
  )
}
