import type { BotUiSnapshot } from '../types'
import { fmtCents } from '../utils/format'

const thBase = 'sticky top-0 bg-zinc-900/60 px-3 py-2'
const tdBase = 'px-3 py-2 whitespace-nowrap'
const colAsset = 'w-[80px] min-w-[80px]'
const colSide = 'w-[80px] min-w-[80px]'
const colSize = 'w-[80px] min-w-[80px]'
const colPrice = 'w-[110px] min-w-[110px]'
const thNum = `${thBase} text-right`
const tdNum = `${tdBase} text-right tabular-nums`
const rowBase = 'border-t border-zinc-800/60 hover:bg-zinc-800/20'
const rowZebra = 'odd:bg-zinc-900/20'
const tableWrap = 'overflow-x-auto overscroll-x-contain rounded-md bg-zinc-900/40 ring-1 ring-zinc-800'
const tableBase = 'w-full border-separate border-spacing-0 text-[14px]'

function AssetBadge(props: { snapshot: BotUiSnapshot; assetId?: string | null }) {
  if (!props.assetId) return <span className="text-zinc-400">n/a</span>
  const tag = assetTag(props.snapshot, props.assetId)
  const cls =
    tag === 'UP'
      ? 'bg-green-600/80 ring-green-500/30'
      : tag === 'DOWN'
        ? 'bg-red-600/80 ring-red-500/30'
        : 'bg-zinc-700/60 ring-zinc-500/20'
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-semibold tracking-wide text-white ring-1 ${cls}`}
    >
      {tag}
    </span>
  )
}

function SideText(props: { side?: string | null }) {
  const s = (props.side ?? '').toUpperCase()
  if (s === 'BUY') return <span className="font-semibold text-green-400">BUY</span>
  if (s === 'SELL') return <span className="font-semibold text-red-400">SELL</span>
  if (!s) return <span className="text-zinc-400">n/a</span>
  return <span className="text-zinc-200">{s}</span>
}

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

type WsOpenOrder = {
  orderId: string
  owner?: string
  market?: string
  assetId?: string
  side?: 'BUY' | 'SELL'
  price?: number
  originalSize?: number
  sizeMatched?: number
  status?: string
  orderType?: string
  outcome?: string
  updatedAtMs: number
}

type OrderSnapshot = {
  clientOrderId: string
  orderId?: string
  assetId: string
  side: 'BUY' | 'SELL'
  price?: number
  originalSize?: number
  sizeMatched?: number
  remaining?: number
  lifecycleState?:
    | 'requested'
    | 'open'
    | 'partially_filled'
    | 'filled'
    | 'canceled'
    | 'rejected'
    | 'expired'
    | 'killed'
  tradeStatusRaw?: string
  tradeStatusRank?: 0 | 1 | 2 | 3
  updatedAtMs: number
}

type Fill = {
  id: string
  tsMs: number
  market?: string
  assetId: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  feeRateBps?: number
  clientOrderId?: string
  orderId?: string
  liquidity?: 'MAKER' | 'TAKER'
}

type PortfolioSnapshot = {
  nowMs: number
  realizedPnlTotal?: number
  positionsByAssetId: Record<string, Position>
  openOrdersByClientId: Record<string, OpenOrder>
  wsOpenOrdersByOrderId?: Record<string, WsOpenOrder>
  ordersByClientId?: Record<string, OrderSnapshot>
  recentFills?: Fill[]
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

function fmtIso(tsMs: unknown): string {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs)) return 'n/a'
  try {
    return new Date(tsMs).toISOString()
  } catch {
    return 'n/a'
  }
}

function fmtTradeStatus(raw: unknown, rank: unknown): string {
  const r = typeof rank === 'number' && Number.isFinite(rank) ? rank : null
  const s = typeof raw === 'string' && raw.length > 0 ? raw : null

  if (s) return r !== null && r > 0 ? `${s} (${r})` : s
  if (r === 1) return 'MATCHED (1)'
  if (r === 2) return 'MINED (2)'
  if (r === 3) return 'CONFIRMED (3)'
  if (r === 0) return '—'
  return 'n/a'
}

function markPriceCents(snapshot: BotUiSnapshot, assetId: string | undefined | null): number | null {
  const tag = assetTag(snapshot, assetId)
  const book = tag === 'UP' ? snapshot.books.up : tag === 'DOWN' ? snapshot.books.down : undefined
  const bid = book?.bestBid
  const ask = book?.bestAsk
  const bidOk = typeof bid === 'number' && Number.isFinite(bid)
  const askOk = typeof ask === 'number' && Number.isFinite(ask)
  if (bidOk && askOk) return (bid! + ask!) / 2
  if (askOk) return ask!
  if (bidOk) return bid!
  return null
}

function shortId(s: unknown, keep = 10): string {
  if (typeof s !== 'string' || s.length === 0) return 'n/a'
  if (s.length <= keep) return s
  return s.slice(-keep)
}

function IdCell(props: { value?: string | null; keep?: number }) {
  const v = props.value ?? null
  const s = typeof v === 'string' && v.length > 0 ? v : null
  const keep = Math.max(6, props.keep ?? 12)
  return (
    <span className="inline-block max-w-[180px] truncate font-mono text-zinc-200" title={s ?? undefined}>
      {shortId(s, keep)}
    </span>
  )
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
          <div className={tableWrap}>
            <table className={tableBase}>
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className={`${thBase} ${colAsset}`}>asset</th>
                  <th className={`${thBase} ${colSide}`}>side</th>
                  <th className={`${thNum} ${colSize}`}>size</th>
                  <th className={`${thNum} ${colPrice}`}>price</th>
                  <th className={thNum}>avgEntryPrice</th>
                  <th className={thBase}>market</th>
                  <th className={thNum}>realizedPnl</th>
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-200 tabular-nums">
                {positions.map(([assetId, p]) => {
                  const resolvedAssetId = p?.assetId ?? assetId
                  const mark = markPriceCents(props.snapshot, resolvedAssetId)
                  const avg = typeof p?.avgEntryPrice === 'number' ? p.avgEntryPrice : null
                  return (
                    <tr key={assetId} className={`${rowBase} ${rowZebra}`}>
                      <td className={`${tdBase} ${colAsset}`}>
                        <AssetBadge snapshot={props.snapshot} assetId={resolvedAssetId} />
                      </td>
                      <td className={`${tdBase} ${colSide}`}>—</td>
                      <td className={`${tdNum} ${colSize}`}>{fmtNum(p?.qty)}</td>
                      <td className={`${tdNum} ${colPrice}`}>{fmtCents(mark)}</td>
                      <td className={tdNum}>{fmtCents(avg)}</td>
                      <td className={tdBase}>{fmtMaybeStr(portfolio.marketByAssetId[assetId])}</td>
                      <td className={tdNum}>{fmtNum(p?.realizedPnl)}</td>
                    </tr>
                  )
                })}
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
  const botOrders = portfolio ? Object.entries(portfolio.openOrdersByClientId) : []
  const wsOrders = portfolio?.wsOpenOrdersByOrderId ? Object.entries(portfolio.wsOpenOrdersByOrderId) : []

  const botOrderIds = new Set<string>()
  for (const [, o] of botOrders) {
    if (typeof o?.orderId === 'string' && o.orderId.length > 0) botOrderIds.add(o.orderId)
  }

  type Row = {
    key: string
    source: 'bot' | 'ws'
    clientOrderId?: string
    orderId?: string
    assetId?: string
    side?: string
    price?: number
    size?: number
    filled?: number
    remaining?: number
    orderType?: string
    expireAtMs?: number
    state?: string
    createdAtMs?: number
    updatedAtMs?: number
    lastError?: string
  }

  const rows: Row[] = []
  for (const [clientOrderId, o] of botOrders) {
    const r: Row = {
      key: `bot:${clientOrderId}`,
      source: 'bot',
      clientOrderId,
      orderId: o?.orderId,
      assetId: o?.assetId,
      side: o?.side,
      price: o?.price,
      size: o?.size,
      filled: o?.filled,
      remaining: o?.remaining,
      orderType: o?.orderType,
      createdAtMs: o?.createdAtMs,
      updatedAtMs: o?.updatedAtMs,
    }
    if (typeof o?.expireAtMs === 'number') r.expireAtMs = o.expireAtMs
    if (typeof o?.state === 'string') r.state = o.state
    if (typeof o?.lastError === 'string') r.lastError = o.lastError
    rows.push(r)
  }

  for (const [orderId, o] of wsOrders) {
    if (botOrderIds.has(orderId)) continue
    const originalSize = typeof o?.originalSize === 'number' ? o.originalSize : undefined
    const sizeMatched = typeof o?.sizeMatched === 'number' ? o.sizeMatched : undefined
    const remaining =
      typeof originalSize === 'number' && typeof sizeMatched === 'number'
        ? Math.max(0, originalSize - sizeMatched)
        : undefined
    const r: Row = {
      key: `ws:${orderId}`,
      source: 'ws',
      orderId,
      updatedAtMs: o?.updatedAtMs,
    }
    if (typeof o?.assetId === 'string') r.assetId = o.assetId
    if (typeof o?.side === 'string') r.side = o.side
    if (typeof o?.price === 'number') r.price = o.price
    if (typeof originalSize === 'number') r.size = originalSize
    if (typeof sizeMatched === 'number') r.filled = sizeMatched
    if (typeof remaining === 'number') r.remaining = remaining
    if (typeof o?.orderType === 'string') r.orderType = o.orderType
    if (typeof o?.status === 'string') r.state = o.status
    rows.push(r)
  }

  rows.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))

  return (
    <div className="panel">
      <div className="panel-h">
        <div className="panel-t">Open orders</div>
        <div className="text-[14px] text-zinc-500">raw snapshot (no computed)</div>
      </div>

      <div className="panel-b">
        {!portfolio ? (
          <div className="text-[16px] text-zinc-400">n/a</div>
        ) : rows.length === 0 ? (
          <div className="text-[16px] text-zinc-400">no open orders</div>
        ) : (
          <div className={tableWrap}>
            <table className={tableBase}>
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className={`${thBase} ${colAsset}`}>asset</th>
                  <th className={`${thBase} ${colSide}`}>side</th>
                  <th className={`${thNum} ${colSize}`}>size</th>
                  <th className={`${thNum} ${colPrice}`}>price</th>
                  <th className={thBase}>source</th>
                  <th className={thNum}>filled</th>
                  <th className={thNum}>remaining</th>
                  <th className={thBase}>orderType</th>
                  <th className={thBase}>state</th>
                  <th className={thBase}>orderId</th>
                  <th className={thBase}>clientOrderId</th>
                  <th className={thNum}>expireAtMs</th>
                  <th className={thBase}>lastError</th>
                  <th className={thNum}>createdAtMs</th>
                  <th className={thNum}>updatedAtMs</th>
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-200 tabular-nums">
                {rows.map((r) => (
                  <tr key={r.key} className={`${rowBase} ${rowZebra}`}>
                    <td className={`${tdBase} ${colAsset}`}>
                      <AssetBadge snapshot={props.snapshot} assetId={r?.assetId} />
                    </td>
                    <td className={`${tdBase} ${colSide}`}>
                      <SideText side={r?.side} />
                    </td>
                    <td className={`${tdNum} ${colSize}`}>{fmtNum(r?.size)}</td>
                    <td className={`${tdNum} ${colPrice}`}>{fmtCents(r?.price)}</td>
                    <td className={tdBase}>{r.source}</td>
                    <td className={tdNum}>{fmtNum(r?.filled)}</td>
                    <td className={tdNum}>{fmtNum(r?.remaining)}</td>
                    <td className={tdBase}>{fmtMaybeStr(r?.orderType)}</td>
                    <td className={tdBase}>{fmtMaybeStr(r?.state)}</td>
                    <td className={tdBase}>
                      <IdCell value={r?.orderId ?? null} keep={12} />
                    </td>
                    <td className={tdBase}>
                      <IdCell value={r?.clientOrderId ?? null} keep={12} />
                    </td>
                    <td className={tdNum}>{fmtNum(r?.expireAtMs)}</td>
                    <td className={tdBase}>{fmtMaybeStr(r?.lastError)}</td>
                    <td className={tdNum}>{fmtNum(r?.createdAtMs)}</td>
                    <td className={tdNum}>{fmtNum(r?.updatedAtMs)}</td>
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

export function ExecutedOrdersTablePanel(props: { snapshot: BotUiSnapshot }) {
  const portfolio = asPortfolio(props.snapshot)
  const fills = portfolio?.recentFills ? [...portfolio.recentFills] : []

  fills.sort((a, b) => (b.tsMs ?? 0) - (a.tsMs ?? 0))

  return (
    <div className="panel">
      <div className="panel-h">
        <div className="panel-t">Executed orders (fills)</div>
        <div className="text-[14px] text-zinc-500">from portfolio.recentFills</div>
      </div>

      <div className="panel-b">
        {!portfolio ? (
          <div className="text-[16px] text-zinc-400">n/a</div>
        ) : fills.length === 0 ? (
          <div className="text-[16px] text-zinc-400">no fills yet</div>
        ) : (
          <div className={tableWrap}>
            <table className={tableBase}>
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className={`${thBase} ${colAsset}`}>asset</th>
                  <th className={`${thBase} ${colSide}`}>side</th>
                  <th className={`${thNum} ${colSize}`}>size</th>
                  <th className={`${thNum} ${colPrice}`}>price</th>
                  <th className={thBase}>liquidity</th>
                  <th className={thNum}>feeBps</th>
                  <th className={thBase}>market</th>
                  <th className={thBase}>orderId</th>
                  <th className={thBase}>clientOrderId</th>
                  <th className={thBase}>fillId</th>
                  <th className={thBase}>time</th>
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-200 tabular-nums">
                {fills.map((f) => (
                  <tr key={f.id} className={`${rowBase} ${rowZebra}`}>
                    <td className={`${tdBase} ${colAsset}`}>
                      <AssetBadge snapshot={props.snapshot} assetId={f.assetId} />
                    </td>
                    <td className={`${tdBase} ${colSide}`}>
                      <SideText side={f.side} />
                    </td>
                    <td className={`${tdNum} ${colSize}`}>{fmtNum(f.size)}</td>
                    <td className={`${tdNum} ${colPrice}`}>{fmtCents(f.price)}</td>
                    <td className={tdBase}>{fmtMaybeStr(f.liquidity)}</td>
                    <td className={tdNum}>{fmtNum(f.feeRateBps)}</td>
                    <td className={tdBase}>{fmtMaybeStr(f.market)}</td>
                    <td className={tdBase}>
                      <IdCell value={f.orderId ?? null} keep={12} />
                    </td>
                    <td className={tdBase}>
                      <IdCell value={f.clientOrderId ?? null} keep={12} />
                    </td>
                    <td className={tdBase}>
                      <IdCell value={f.id ?? null} keep={12} />
                    </td>
                    <td className={tdBase}>{fmtIso(f.tsMs)}</td>
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

export function OrdersByClientIdTablePanel(props: { snapshot: BotUiSnapshot }) {
  const portfolio = asPortfolio(props.snapshot)
  const orders = portfolio?.ordersByClientId ? Object.entries(portfolio.ordersByClientId) : []

  type Row = {
    clientOrderId: string
    orderId?: string
    assetId?: string
    side?: string
    price?: number
    originalSize?: number
    sizeMatched?: number
    remaining?: number
    lifecycleState?: string
    tradeStatusRaw?: string
    tradeStatusRank?: number
    updatedAtMs?: number
  }

  const rows: Row[] = []
  for (const [clientOrderId, o] of orders) {
    const r: Row = {
      clientOrderId,
      updatedAtMs: o?.updatedAtMs,
    }
    if (typeof o?.orderId === 'string') r.orderId = o.orderId
    if (typeof o?.assetId === 'string') r.assetId = o.assetId
    if (typeof o?.side === 'string') r.side = o.side
    if (typeof o?.price === 'number') r.price = o.price
    if (typeof o?.originalSize === 'number') r.originalSize = o.originalSize
    if (typeof o?.sizeMatched === 'number') r.sizeMatched = o.sizeMatched
    if (typeof o?.remaining === 'number') r.remaining = o.remaining
    if (typeof o?.lifecycleState === 'string') r.lifecycleState = o.lifecycleState
    if (typeof o?.tradeStatusRaw === 'string') r.tradeStatusRaw = o.tradeStatusRaw
    if (typeof o?.tradeStatusRank === 'number') r.tradeStatusRank = o.tradeStatusRank
    rows.push(r)
  }

  rows.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))

  return (
    <div className="panel">
      <div className="panel-h">
        <div className="panel-t">Orders (by clientOrderId)</div>
        <div className="text-[14px] text-zinc-500">from portfolio.ordersByClientId</div>
      </div>

      <div className="panel-b">
        {!portfolio ? (
          <div className="text-[16px] text-zinc-400">n/a</div>
        ) : rows.length === 0 ? (
          <div className="text-[16px] text-zinc-400">no orders yet</div>
        ) : (
          <div className={tableWrap}>
            <table className={tableBase}>
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className={`${thBase} ${colAsset}`}>asset</th>
                  <th className={`${thBase} ${colSide}`}>side</th>
                  <th className={`${thNum} ${colSize}`}>size</th>
                  <th className={`${thNum} ${colPrice}`}>price</th>
                  <th className={thNum}>matched</th>
                  <th className={thNum}>rem</th>
                  <th className={thBase}>lifecycle</th>
                  <th className={thBase}>tradeStatus</th>
                  <th className={thBase}>orderId</th>
                  <th className={thBase}>clientOrderId</th>
                  <th className={thBase}>time</th>
                </tr>
              </thead>
              <tbody className="font-mono text-zinc-200 tabular-nums">
                {rows.map((r) => (
                  <tr key={r.clientOrderId} className={`${rowBase} ${rowZebra}`}>
                    <td className={`${tdBase} ${colAsset}`}>
                      <AssetBadge snapshot={props.snapshot} assetId={r.assetId} />
                    </td>
                    <td className={`${tdBase} ${colSide}`}>
                      <SideText side={r.side} />
                    </td>
                    <td className={`${tdNum} ${colSize}`}>{fmtNum(r.originalSize)}</td>
                    <td className={`${tdNum} ${colPrice}`}>{fmtCents(r.price)}</td>
                    <td className={tdNum}>{fmtNum(r.sizeMatched)}</td>
                    <td className={tdNum}>{fmtNum(r.remaining)}</td>
                    <td className={tdBase}>{fmtMaybeStr(r.lifecycleState)}</td>
                    <td className={tdBase}>{fmtTradeStatus(r.tradeStatusRaw, r.tradeStatusRank)}</td>
                    <td className={tdBase}>
                      <IdCell value={r.orderId ?? null} keep={12} />
                    </td>
                    <td className={tdBase}>
                      <IdCell value={r.clientOrderId ?? null} keep={12} />
                    </td>
                    <td className={tdBase}>{fmtIso(r.updatedAtMs)}</td>
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


