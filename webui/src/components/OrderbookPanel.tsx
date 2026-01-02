import type { BotUiOrderBook } from '../types'

function fmtPrice(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toFixed(4)
}

function fmtSize(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toFixed(3)
}

function BookTable(props: { side: 'up' | 'down'; book: BotUiOrderBook }) {
  const asks = props.book.asks ?? []
  const bids = props.book.bids ?? []

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="mb-1 text-xs font-semibold text-zinc-300">ASK</div>
        <div className="rounded-md bg-zinc-900/60 ring-1 ring-zinc-800">
          <div className="grid grid-cols-2 gap-2 border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">
            <div>price</div>
            <div className="text-right">size</div>
          </div>
          <div className="font-mono text-xs">
            {asks
              .slice()
              .reverse()
              .map((a, idx) => (
                <div key={idx} className="grid grid-cols-2 gap-2 px-2 py-1">
                  <div className="text-red-300">{fmtPrice(a.price)}</div>
                  <div className="text-right text-zinc-200">{fmtSize(a.size)}</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold text-zinc-300">BID</div>
        <div className="rounded-md bg-zinc-900/60 ring-1 ring-zinc-800">
          <div className="grid grid-cols-2 gap-2 border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">
            <div>price</div>
            <div className="text-right">size</div>
          </div>
          <div className="font-mono text-xs">
            {bids.map((b, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2 px-2 py-1">
                <div className="text-emerald-300">{fmtPrice(b.price)}</div>
                <div className="text-right text-zinc-200">{fmtSize(b.size)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function OrderbookPanel(props: { label: 'UP' | 'DOWN'; book?: BotUiOrderBook }) {
  const book = props.book
  const bb = fmtPrice(book?.bestBid)
  const ba = fmtPrice(book?.bestAsk)
  const spread =
    typeof book?.bestBid === 'number' &&
    Number.isFinite(book.bestBid) &&
    typeof book?.bestAsk === 'number' &&
    Number.isFinite(book.bestAsk)
      ? book.bestAsk - book.bestBid
      : undefined

  return (
    <div className="rounded-lg bg-zinc-950/40 p-3 ring-1 ring-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{props.label}</div>
        <div className="flex items-center gap-2 font-mono text-xs text-zinc-300">
          <span className="text-red-300">ask {ba}</span>
          <span className="text-zinc-500">/</span>
          <span className="text-emerald-300">bid {bb}</span>
          <span className="text-zinc-500">/</span>
          <span className="text-zinc-300">spr {typeof spread === 'number' ? spread.toFixed(4) : 'n/a'}</span>
        </div>
      </div>

      {book ? (
        <BookTable side={props.label === 'UP' ? 'up' : 'down'} book={book} />
      ) : (
        <div className="text-sm text-zinc-400">no data</div>
      )}
    </div>
  )
}


