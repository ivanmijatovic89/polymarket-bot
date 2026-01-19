import type { BotUiSnapshot } from '../types'
import { fmtCents } from '../utils/format'

type VolatilityWindowStats = {
  windowMs: number
  n: number
  startTsMs: number | null
  endTsMs: number | null
  coverageMs: number | null
  ready: boolean
  staleMs: number | null
  startPrice: number | null
  endPrice: number | null
  netChange: number | null
  low: number | null
  high: number | null
  stddev: number | null
  highLowRange: number | null
  avgAbsChange: number | null
}

type VolatilitySnapshot = {
  asOfTsMs: number | null
  byAssetId: Record<string, Record<string, VolatilityWindowStats>>
}

function fmt(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(6)
}

function fmtBool(b: unknown): string {
  return b === true ? 'true' : b === false ? 'false' : 'n/a'
}

function pickVol(snapshot: BotUiSnapshot): VolatilitySnapshot | null {
  const plugins = (snapshot as unknown as { plugins?: any }).plugins
  const vol = plugins?.timeWindowVolatility
  if (!vol || typeof vol !== 'object') return null
  if (!vol.byAssetId || typeof vol.byAssetId !== 'object') return null
  return vol as VolatilitySnapshot
}

function Section(props: { label: 'UP' | 'DOWN'; assetId?: string; vol: VolatilitySnapshot }) {
  const { label, assetId, vol } = props
  const byWindow = assetId ? vol.byAssetId[assetId] : undefined
  const rows = byWindow
    ? Object.entries(byWindow)
        .map(([windowLabel, s]) => ({ windowLabel, s }))
        .sort((a, b) => (a.s.windowMs ?? 0) - (b.s.windowMs ?? 0))
    : []

  const cols: Array<{ key: string; className: string }> = [
    { key: 'window', className: 'w-[72px]' },
    { key: 'low', className: 'w-[96px]' },
    { key: 'high', className: 'w-[96px]' },
    { key: 'highLowRange', className: 'w-[132px]' },
    { key: 'stddev', className: 'w-[128px]' },
    { key: 'avgAbsChange', className: 'w-[148px]' },
    { key: 'n', className: 'w-[64px]' },
    { key: 'startPrice', className: 'w-[120px]' },
    { key: 'endPrice', className: 'w-[120px]' },
    { key: 'netChange', className: 'w-[120px]' },
    { key: 'ready', className: 'w-[92px]' },
    { key: 'coverageMs', className: 'w-[128px]' },
    { key: 'staleMs', className: 'w-[120px]' },
  ]

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">{label}</div>
        <div className="text-[12px] font-mono text-zinc-500">{assetId ? assetId.slice(-10) : 'n/a'}</div>
      </div>

      {!assetId ? (
        <div className="text-[14px] text-zinc-400">missing assetId</div>
      ) : !byWindow ? (
        <div className="text-[14px] text-zinc-400">no volatility yet</div>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain rounded-md bg-zinc-900/40 ring-1 ring-zinc-800">
          <table className="w-full table-fixed border-separate border-spacing-0 text-[18px]">
            <colgroup>{cols.map((c) => <col key={c.key} className={c.className} />)}</colgroup>
            <thead>
              <tr className="text-left text-zinc-400">
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">window</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">low</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">high</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">highLowRange</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">stddev</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">avgAbsChange</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">n</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">startPrice</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">endPrice</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">netChange</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">ready</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">coverageMs</th>
                <th className="sticky top-0 bg-zinc-900/60 px-2 py-1.5">staleMs</th>
              </tr>
            </thead>
            <tbody className="font-mono text-zinc-200">
              {rows.map(({ windowLabel, s }) => (
                <tr key={windowLabel} className="border-t border-zinc-800/60">
                  <td className="px-2 py-1.5 whitespace-nowrap">{windowLabel}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtCents(s.low, { fixed: true, digits: 2 })}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtCents(s.high, { fixed: true, digits: 2 })}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtCents(s.highLowRange, { fixed: true, digits: 2 })}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmt(s.stddev)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmt(s.avgAbsChange)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmt(s.n)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtCents(s.startPrice, { fixed: true, digits: 2 })}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtCents(s.endPrice, { fixed: true, digits: 2 })}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtCents(s.netChange, { fixed: true, digits: 2 })}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtBool(s.ready)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmt(s.coverageMs)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmt(s.staleMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function VolatilityPanel(props: { snapshot: BotUiSnapshot }) {
  const vol = pickVol(props.snapshot)
  if (!vol) return null

  const status = props.snapshot.status
  const upId = status.upAssetId
  const downId = status.downAssetId

  return (
    <div className="panel p-2.5 min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold text-zinc-200">volatility</div>
        <div className="text-[12px] font-mono text-zinc-500">asOfTsMs {fmt(vol.asOfTsMs)}</div>
      </div>

      <div className="space-y-2">
        <Section label="UP" assetId={upId} vol={vol} />
        <Section label="DOWN" assetId={downId} vol={vol} />
      </div>
    </div>
  )
}


