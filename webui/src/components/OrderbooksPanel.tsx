import type { BotUiOrderBook, BotUiOrderBookLevel } from '../types'
import { fmtCents } from '../utils/format'

const LEVEL_ROWS = 8

function fmtSize(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toFixed(2)
}

function SideTable(props: { rows: BotUiOrderBookLevel[]; side: 'ask' | 'bid' }) {
  const { rows, side } = props
  const padded: Array<BotUiOrderBookLevel | null> = (() => {
    // Keep the "best" level closest to the spread:
    // - asks are rendered with best ask at the bottom -> pad missing rows at the TOP
    // - bids are rendered with best bid at the top -> pad missing rows at the BOTTOM
    const base: Array<BotUiOrderBookLevel | null> = rows.slice(0, LEVEL_ROWS)
    while (base.length < LEVEL_ROWS) {
      if (side === 'ask') base.unshift(null)
      else base.push(null)
    }
    return base.slice(0, LEVEL_ROWS)
  })()
  return (
    <div className="rounded-md bg-zinc-900/60 ring-1 ring-zinc-800">
      <div className="font-mono text-[14px]">
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

function OneBook(props: { label: 'UP' | 'DOWN'; book?: BotUiOrderBook }) {
  const book = props.book
  const bb = fmtCents(book?.bestBid, { fixed: true, digits: 2 })
  const ba = fmtCents(book?.bestAsk, { fixed: true, digits: 2 })
  const spread =
    typeof book?.bestBid === 'number' &&
    Number.isFinite(book.bestBid) &&
    typeof book?.bestAsk === 'number' &&
    Number.isFinite(book.bestAsk)
      ? book.bestAsk - book.bestBid
      : undefined

  // Keep best ask closest to spread (bottom of asks),
  // and best bid closest to spread (top of bids).
  const asksForView = (book?.asks ?? []).slice().reverse()
  const bidsForView = book?.bids ?? []

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">{props.label}</div>
        <div className="flex items-center gap-2 font-mono text-[14px] text-zinc-300">
          <span className="text-red-300">ask {ba}</span>
          <span className="text-zinc-500">/</span>
          <span className="text-emerald-300">bid {bb}</span>
        </div>
      </div>

      {book ? (
        <div className="space-y-1.5">
          <SideTable rows={asksForView} side="ask" />

          <div className="rounded-md bg-zinc-900/40 px-2 py-1.5 ring-1 ring-zinc-800">
            <div className="flex items-center justify-between gap-2 text-[14px]">
              <div className="font-mono text-zinc-200">{fmtCents(spread, { fixed: true, digits: 2 })}</div>
              <div className="text-zinc-400">spread</div>
            </div>
          </div>

          <SideTable rows={bidsForView} side="bid" />
        </div>
      ) : (
        <div className="text-[14px] text-zinc-400">no data</div>
      )}
    </div>
  )
}

export function OrderbooksPanel(props: { up?: BotUiOrderBook; down?: BotUiOrderBook }) {
  return (
    <div className="panel p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold text-zinc-200">orderbooks</div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <OneBook label="UP" book={props.up} />
        <OneBook label="DOWN" book={props.down} />
      </div>
    </div>
  )
}


