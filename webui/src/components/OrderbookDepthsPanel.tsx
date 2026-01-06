import type { BotUiOrderBook } from '../types'

function fmtSize(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function OneDepthTable(props: { label: 'UP' | 'DOWN'; book?: BotUiOrderBook }) {
  const b = props.book
  const bids = b?.bidsDepthByLevel ?? []
  const asks = b?.asksDepthByLevel ?? []
  const n =
    typeof b?.depthLevels === 'number' && Number.isFinite(b.depthLevels) ? Math.max(0, Math.floor(b.depthLevels)) : 0
  const rowsN = Math.max(n, bids.length, asks.length)

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[18px] font-semibold">{props.label}</div>
        <div className="text-[12px] font-mono text-zinc-500">{rowsN > 0 ? `levels ${rowsN}` : 'n/a'}</div>
      </div>

      {rowsN === 0 ? (
        <div className="text-[14px] text-zinc-400">no depth data</div>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain rounded-md bg-zinc-900/40 ring-1 ring-zinc-800">
          <table className="w-full table-fixed border-separate border-spacing-0 text-[18px]">
            <colgroup>
              <col className="w-[72px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
            </colgroup>
            <thead>
              <tr className="text-left text-zinc-400">
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">level</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">bidsDepth</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">asksDepth</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-200">
              {Array.from({ length: rowsN }).map((_, i) => (
                <tr key={i} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1.5 whitespace-nowrap">{i + 1}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-emerald-300">{fmtSize(bids[i])}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-red-300">{fmtSize(asks[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function OrderbookDepthsPanel(props: { up?: BotUiOrderBook; down?: BotUiOrderBook }) {
  return (
    <div className="panel p-2.5 min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[18px] font-semibold text-zinc-200">orderbook depths</div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <OneDepthTable label="UP" book={props.up} />
        <OneDepthTable label="DOWN" book={props.down} />
      </div>
    </div>
  )
}