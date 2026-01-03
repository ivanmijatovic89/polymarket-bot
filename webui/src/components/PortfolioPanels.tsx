import type { BotUiSnapshot } from '../types'
import { fmtCents } from '../utils/format'

type Position = {
  assetId: string
  qty: number
  avgEntryPrice: number | null
  realizedPnl: number
}

type OpenOrder = {
  clientOrderId: string
  orderId?: string
  market?: string
  assetId: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  remaining: number
  filled: number
  orderType: 'FOK' | 'GTC' | 'GTD'
  expireAtMs?: number
  state:
    | 'requested'
    | 'open'
    | 'partially_filled'
    | 'filled'
    | 'canceled'
    | 'rejected'
    | 'expired'
    | 'killed'
  createdAtMs: number
  updatedAtMs: number
  lastError?: string
}

type PortfolioSnapshot = {
  nowMs: number
  realizedPnlTotal?: number
  positionsByAssetId: Record<string, Position>
  openOrdersByClientId: Record<string, OpenOrder>
  marketByAssetId: Record<string, string>
}

function asPortfolio(snapshot: BotUiSnapshot): PortfolioSnapshot | null {
  const p = (snapshot as unknown as { portfolio?: unknown }).portfolio as any
  if (!p || typeof p !== 'object') return null
  if (!p.positionsByAssetId || typeof p.positionsByAssetId !== 'object') return null
  if (!p.openOrdersByClientId || typeof p.openOrdersByClientId !== 'object') return null
  if (!p.marketByAssetId || typeof p.marketByAssetId !== 'object') return null
  return p as PortfolioSnapshot
}

function assetTag(snapshot: BotUiSnapshot, assetId: string | undefined | null): 'UP' | 'DOWN' | 'OTHER' {
  const s = snapshot as unknown as { status?: { upAssetId?: string; downAssetId?: string } }
  const up = s.status?.upAssetId
  const down = s.status?.downAssetId
  if (assetId && up && assetId === up) return 'UP'
  if (assetId && down && assetId === down) return 'DOWN'
  return 'OTHER'
}

function fmtNum(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return String(n)
}

function fmtMaybeStr(s: unknown): string {
  return typeof s === 'string' && s.length > 0 ? s : 'n/a'
}

export function PositionsTablePanel(props: { snapshot: BotUiSnapshot }) {
  const portfolio = asPortfolio(props.snapshot)
  const positions = portfolio ? Object.entries(portfolio.positionsByAssetId) : []

  return (
    <div className="panel">
      <div className="panel-h">
        <div className="panel-t">Positions</div>
        <div className="text-[14px] text-zinc-500 font-mono">
          nowMs {portfolio ? fmtNum(portfolio.nowMs) : 'n/a'} | realizedPnlTotal{' '}
          {portfolio ? fmtNum(portfolio.realizedPnlTotal) : 'n/a'}
        </div>
      </div>

      <div className="panel-b">
        {!portfolio ? (
          <div className="text-[16px] text-zinc-400">n/a</div>
        ) : positions.length === 0 ? (
          <div className="text-[16px] text-zinc-400">no positions</div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain rounded-md bg-zinc-900/40 ring-1 ring-zinc-800">
            <table className="w-full border-separate border-spacing-0 text-[14px]">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">asset</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">market</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">qty</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">avgEntryPrice</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">realizedPnl</th>
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-200">
                {positions.map(([assetId, p]) => (
                  <tr key={assetId} className="border-t border-zinc-800/60">
                    <td className="px-3 py-2 whitespace-nowrap">{assetTag(props.snapshot, p?.assetId ?? assetId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtMaybeStr(portfolio.marketByAssetId[assetId])}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(p?.qty)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtCents(p?.avgEntryPrice ?? null)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(p?.realizedPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export function OpenOrdersTablePanel(props: { snapshot: BotUiSnapshot }) {
  const portfolio = asPortfolio(props.snapshot)
  const openOrders = portfolio ? Object.entries(portfolio.openOrdersByClientId) : []

  return (
    <div className="panel">
      <div className="panel-h">
        <div className="panel-t">Open orders</div>
        <div className="text-[14px] text-zinc-500">raw snapshot (no computed)</div>
      </div>

      <div className="panel-b">
        {!portfolio ? (
          <div className="text-[16px] text-zinc-400">n/a</div>
        ) : openOrders.length === 0 ? (
          <div className="text-[16px] text-zinc-400">no open orders</div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain rounded-md bg-purple-500 ring-1 ring-zinc-800">
            <table className="w-full border-separate border-spacing-0 text-[14px]">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">asset</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">side</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">price</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">size</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">filled</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">remaining</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">orderType</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">expireAtMs</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">state</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">createdAtMs</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">updatedAtMs</th>
                  <th className="sticky top-0 bg-zinc-900/60 px-3 py-2">lastError</th>
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-200">
                {openOrders.map(([clientOrderId, o]) => (
                  <tr key={clientOrderId} className="border-t border-zinc-800/60">
                    <td className="px-3 py-2 whitespace-nowrap">{assetTag(props.snapshot, o?.assetId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtMaybeStr(o?.side)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtCents(o?.price)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(o?.size)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(o?.filled)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(o?.remaining)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtMaybeStr(o?.orderType)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(o?.expireAtMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtMaybeStr(o?.state)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(o?.createdAtMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtNum(o?.updatedAtMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtMaybeStr(o?.lastError)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}


