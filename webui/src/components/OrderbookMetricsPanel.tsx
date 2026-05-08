import type { BotUiSnapshot } from '../types'

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

function fmtRatio(x: unknown): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
  return x.toFixed(4)
}

function fmtSide(x: unknown): string {
  return x === 'UP' || x === 'DOWN' || x === 'NONE' ? x : '—'
}

export function OrderbookMetricsPanel(props: { snapshot: BotUiSnapshot }) {
  const om = asOrderbookMetrics(props.snapshot)
  if (!om) {
    return (
      <div className="panel p-2.5 min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[18px] font-semibold text-zinc-200">orderbook metrics</div>
        </div>
        <div className="text-[14px] text-zinc-400">no orderbook metrics</div>
      </div>
    )
  }

  const rowsN = Math.max(
    Math.max(0, Math.floor(om.depthLevels)),
    om.weakBidSideByLevel.length,
    om.weakBidRatioByLevel.length,
    om.weakAskSideByLevel.length,
    om.weakAskRatioByLevel.length,
  )

  return (
    <div className="panel p-2.5 min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[18px] font-semibold text-zinc-200">orderbook metrics</div>
        <div className="text-[12px] font-mono text-zinc-500">
          {rowsN > 0 ? `levels ${rowsN}` : 'n/a'}
        </div>
      </div>

      {rowsN === 0 ? (
        <div className="text-[14px] text-zinc-400">no levels</div>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain rounded-md bg-zinc-900/40 ring-1 ring-zinc-800">
          <table className="w-full table-fixed border-separate border-spacing-0 text-[16px]">
            <colgroup>
              <col className="w-[64px]" />
              <col className="w-[90px]" />
              <col className="w-[110px]" />
              <col className="w-[90px]" />
              <col className="w-[110px]" />
            </colgroup>
            <thead>
              <tr className="text-left text-zinc-400">
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">lvl</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">bidSide</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">bidRatio</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">askSide</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">askRatio</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-200">
              {Array.from({ length: rowsN }).map((_, i) => (
                <tr key={i} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1.5 whitespace-nowrap">{i + 1}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-emerald-300">
                    {fmtSide(om.weakBidSideByLevel[i])}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {fmtRatio(om.weakBidRatioByLevel[i])}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-red-300">
                    {fmtSide(om.weakAskSideByLevel[i])}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {fmtRatio(om.weakAskRatioByLevel[i])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
