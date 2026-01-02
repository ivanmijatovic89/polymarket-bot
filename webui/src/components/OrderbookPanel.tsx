import type { BotUiOrderBook, BotUiOrderBookLevel } from '../types'
import { fmtCents } from '../utils/format'

function fmtSize(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toFixed(3)
}

function SideTable(props: { title: 'ASK' | 'BID'; rows: BotUiOrderBookLevel[]; side: 'ask' | 'bid' }) {
  const { title, rows, side } = props

  return (
    <div>

      <div className="rounded-md bg-zinc-900/60 ring-1 ring-zinc-800">
        <div className="font-mono text-[16px]">
          {rows.length === 0 ? (
            <div className="px-3 py-2 text-[16px] text-zinc-500">n/a</div>
          ) : (
            rows.map((r, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2 px-3 py-1">
                <div className={side === 'ask' ? 'text-red-300' : 'text-emerald-300'}>{fmtCents(r.price)}</div>
                <div className="text-right text-zinc-200">{fmtSize(r.size)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export function OrderbookPanel(props: { label: 'UP' | 'DOWN'; book?: BotUiOrderBook }) {
  const book = props.book
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
  const asksForView = (book?.asks ?? []).slice().reverse()
  const bidsForView = book?.bids ?? []

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[17px] font-semibold">{props.label}</div>
        <div className="flex items-center gap-2 font-mono text-[16px] text-zinc-300">
          <span className="text-red-300">ask {ba}</span>
          <span className="text-zinc-500">/</span>
          <span className="text-emerald-300">bid {bb}</span>
        </div>
      </div>

      {book ? (
        <div className="space-y-2">
          <SideTable title="ASK" rows={asksForView} side="ask" />

          <div className="rounded-md bg-zinc-900/40 px-3 py-2 ring-1 ring-zinc-800">
            <div className="flex items-center justify-between gap-2 text-[16px]">
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


