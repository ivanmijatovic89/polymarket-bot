import { ConnectionBadge } from './components/ConnectionBadge'
import { ExternalFeedsPanel } from './components/ExternalFeedsPanel'
import { LogsPanel } from './components/LogsPanel'
import { OrderbookDepthsPanel } from './components/OrderbookDepthsPanel'
import { OrderbooksPanel } from './components/OrderbooksPanel'
import {
  ExecutedOrdersTablePanel,
  OpenOrdersTablePanel,
  OrdersByClientIdTablePanel,
  PositionsTablePanel,
} from './components/PortfolioPanels'
import { VolatilityPanel } from './components/VolatilityPanel'
import { useBotWs } from './hooks/useBotWs'
import { fmtCents } from './utils/format'

function bestAskFromBook(book?: { bestAsk?: number }): number | null {
  const a = book?.bestAsk
  if (typeof a !== 'number' || !Number.isFinite(a)) return null
  return a
}

function fmtShortJson(x: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(x)
    if (!s) return 'n/a'
    if (s.length <= maxLen) return s
    return `${s.slice(0, Math.max(0, maxLen - 1))}…`
  } catch {
    return 'n/a'
  }
}

function fmtList(xs: string[] | undefined, emptyLabel = 'none'): string {
  if (!xs || xs.length === 0) return emptyLabel
  return xs.join(', ')
}

function feedKeysFromData(snapshot: unknown): string[] {
  const s = snapshot as any
  const feeds = s?.feeds
  const out: string[] = []
  if (feeds?.rtdsPolymarketCryptoPrices?.binance) out.push('rtds:binance')
  if (feeds?.rtdsPolymarketCryptoPrices?.chainlink) out.push('rtds:chainlink')
  if (feeds?.binanceWsSpotPrice) out.push('binance_ws')
  if (feeds?.polymarketPriceToBeat) out.push('price_to_beat')
  return out
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

function makeMockPortfolio(snapshot: any): { portfolio: any; positionMetrics: any } {
  const now = Date.now()
  const up = snapshot?.status?.upAssetId ?? 'UP_ASSET_ID'
  const down = snapshot?.status?.downAssetId ?? 'DOWN_ASSET_ID'
  const slug = snapshot?.status?.slug ?? 'up-down-15m-mock'

  const clientA = 'mock_cli_001'
  const clientB = 'mock_cli_002'
  const clientC = 'mock_cli_003'
  const orderA = '0xmock_order_a'
  const orderB = '0xmock_order_b'
  const orderC = '0xmock_order_c'

  // Polymarket-style prices: 0..100 cents.
  // Make them roughly complementary so UP + DOWN ~= 100.
  const pxUp = 0.542
  const pxDown = 0.458

  // Shares are typically small integers/decimals.
  // We'll keep sizes simple and consistent with fills/orders.
  const posUpQty: number = 18 // shares
  const posDownQty: number = 6 // shares

  // Prices are stored as 0..1 (displayed as cents in UI via fmtCents()).
  // Weighted average entry for UP: 10 @ 0.540 + 8 @ 0.545 => 0.54222...
  const upAvgEntry = (10 * 0.54 + 8 * 0.545) / 18
  const downAvgEntry = 0.461 // bought earlier slightly worse than current 0.458

  // Position Metrics (same simplified math as backend)
  const upCostBasis = posUpQty * upAvgEntry
  const downCostBasis = posDownQty * downAvgEntry
  const totalCost = upCostBasis + downCostBasis
  const sharesMergeable = Math.min(posUpQty, posDownQty)
  const sharesUpUnpaired = posUpQty - sharesMergeable
  const sharesDownUnpaired = posDownQty - sharesMergeable
  const totalShares = posUpQty + posDownQty
  const pairAvg = upAvgEntry + downAvgEntry

  const positionMetrics = {
    shares_mergeable: sharesMergeable,
    pair_avg: pairAvg,
    total_cost: totalCost,
    pnl_merge: sharesMergeable - totalCost,
    pnl_if_up_wins: posUpQty - totalCost,
    pnl_if_down_wins: posDownQty - totalCost,
    imbalance: posUpQty - posDownQty,
  }

  const portfolio = {
    nowMs: now,
    realizedPnlTotal: 0.42,
    positionsByAssetId: {
      [up]: { assetId: up, qty: posUpQty, avgEntryPrice: upAvgEntry, costBasis: upCostBasis },
      [down]: {
        assetId: down,
        qty: posDownQty,
        avgEntryPrice: downAvgEntry,
        costBasis: downCostBasis,
      },
    },
    openOrdersByClientId: {
      [clientA]: {
        clientOrderId: clientA,
        orderId: orderA,
        market: slug,
        assetId: up,
        side: 'BUY',
        // Recently placed bid slightly below last traded price
        price: 0.54,
        size: 25,
        remaining: 17,
        filled: 8,
        orderType: 'GTC',
        state: 'partially_filled',
        createdAtMs: now - 75_000,
        updatedAtMs: now - 4_000,
      },
      [clientB]: {
        clientOrderId: clientB,
        orderId: orderB,
        market: slug,
        assetId: down,
        side: 'SELL',
        // Offer slightly above "fair" for DOWN
        price: 0.466,
        size: 6,
        remaining: 6,
        filled: 0,
        orderType: 'GTC',
        state: 'open',
        createdAtMs: now - 40_000,
        updatedAtMs: now - 10_000,
      },
    },
    ordersByClientId: {
      [clientA]: {
        clientOrderId: clientA,
        orderId: orderA,
        assetId: up,
        side: 'BUY',
        price: 0.54,
        originalSize: 25,
        sizeMatched: 8,
        remaining: 17,
        lifecycleState: 'partially_filled',
        tradeStatusRaw: 'MATCHED',
        tradeStatusRank: 1,
        updatedAtMs: now - 4_000,
      },
      [clientB]: {
        clientOrderId: clientB,
        orderId: orderB,
        assetId: down,
        side: 'SELL',
        price: 0.466,
        originalSize: 6,
        sizeMatched: 0,
        remaining: 6,
        lifecycleState: 'open',
        tradeStatusRank: 0,
        updatedAtMs: now - 10_000,
      },
      [clientC]: {
        clientOrderId: clientC,
        orderId: orderC,
        assetId: up,
        side: 'BUY',
        // Older completed order: fully filled and confirmed
        price: 0.545,
        originalSize: 10,
        sizeMatched: 10,
        remaining: 0,
        lifecycleState: 'filled',
        tradeStatusRaw: 'CONFIRMED',
        tradeStatusRank: 3,
        updatedAtMs: now - 180_000,
      },
    },
    wsOpenOrdersByOrderId: {
      '0xmock_ws_only': {
        orderId: '0xmock_ws_only',
        market: slug,
        assetId: up,
        side: 'SELL',
        // A small ask sitting above the market
        price: 0.555,
        originalSize: 5,
        sizeMatched: 0,
        status: 'OPEN',
        orderType: 'GTC',
        updatedAtMs: now - 2_500,
      },
    },
    recentFills: [
      {
        id: 'mock_fill_003',
        tsMs: now - 12_000,
        market: slug,
        assetId: up,
        side: 'BUY',
        price: 0.54,
        size: 8,
        feeRateBps: 2,
        clientOrderId: clientA,
        orderId: orderA,
        liquidity: 'MAKER',
      },
      {
        id: 'mock_fill_002',
        tsMs: now - 160_000,
        market: slug,
        assetId: up,
        side: 'BUY',
        price: 0.545,
        size: 10,
        feeRateBps: 5,
        clientOrderId: clientC,
        orderId: orderC,
        liquidity: 'TAKER',
      },
      {
        id: 'mock_fill_001',
        tsMs: now - 300_000,
        market: slug,
        assetId: down,
        side: 'BUY',
        price: 0.461,
        size: posDownQty,
        feeRateBps: 2,
        liquidity: 'MAKER',
      },
    ],
    marketByAssetId: {
      [up]: slug,
      [down]: slug,
    },
  }

  return { portfolio, positionMetrics }
}

export function App() {
  const { status, snapshot, logLines } = useBotWs()
  const mockPortfolioEnabled = new URLSearchParams(window.location.search).has('mockPortfolio')
  const displaySnapshot =
    snapshot && mockPortfolioEnabled ? ({ ...snapshot, ...makeMockPortfolio(snapshot) } as any) : snapshot

  const upAsk = displaySnapshot ? bestAskFromBook(displaySnapshot.books.up) : null
  const downAsk = displaySnapshot ? bestAskFromBook(displaySnapshot.books.down) : null
  const strategy = displaySnapshot?.strategy
  const indEnabled = displaySnapshot?.strategy?.indicators ?? []
  const feedsDataKeys = displaySnapshot ? feedKeysFromData(displaySnapshot) : []
  const hasVolatility = Boolean((displaySnapshot as any)?.indicators?.volatility)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800  backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2 px-2 py-2">
          <div className="flex min-w-0 items-center gap-2 md:min-w-[260px]">
            <div className="text-sm font-semibold text-zinc-100">polymarket-bot</div>
            <ConnectionBadge status={status} />
            {displaySnapshot ? (
              <span className="chip text-[24px] bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                ⏳ <span className="ml-1 font-mono">{fmtMs(displaySnapshot.status.candleLeftMs)}</span>
              </span>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-center">
              <div className="flex ring-1 bg-green-600/80 ring-green-500/30 font-mono text-[22px] text-white px-10 py-3 rounded-md rounded-r-none">
                <span className="text-white">{fmtCents(upAsk, { fixed: true, digits: 2 })} ¢</span>
              </div>
              <div className="flex ring-1 bg-red-600/80 ring-red-500/30 font-mono text-[22px] text-white px-10 py-3 rounded-md rounded-l-none">
                <span className="text-white">{fmtCents(downAsk, { fixed: true, digits: 2 })} ¢</span>
              </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-2 md:min-w-[360px]">
            {displaySnapshot ? (
              <>
                <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                  slug <span className="ml-1 font-mono">{displaySnapshot.status.slug ?? 'n/a'}</span>
                </span>
                <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                  ws attempt <span className="ml-1 font-mono">{displaySnapshot.status.wsAttempt}</span>
                </span>
                <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                  ws events <span className="ml-1 font-mono">{displaySnapshot.status.wsEventsTotal}</span>
                </span>
              </>
            ) : (
              <div className="text-[14px] text-zinc-500">webui</div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto  px-2 py-2 pb-16">
        {!displaySnapshot ? (
          <div className="panel panel-b text-zinc-300">waiting for snapshot…</div>
        ) : (
          <div className="space-y-2">
            {/* Full-width row under header */}
            <ExternalFeedsPanel snapshot={displaySnapshot} />

            {/* Full-width: portfolio + orders */}
            <div className="space-y-2">
              <PositionsTablePanel snapshot={displaySnapshot} />
              <OpenOrdersTablePanel snapshot={displaySnapshot} />
              <ExecutedOrdersTablePanel snapshot={displaySnapshot} />
              <OrdersByClientIdTablePanel snapshot={displaySnapshot} />
            </div>


            <div className="space-y-2">
            <LogsPanel logLines={logLines} />
            </div>

            <div className="space-y-2 min-w-0">
              <div className="grid grid-cols-1 gap-2 min-w-0 xl:grid-cols-2">
                <OrderbooksPanel up={displaySnapshot.books.up} down={displaySnapshot.books.down} />
                <OrderbookDepthsPanel up={displaySnapshot.books.up} down={displaySnapshot.books.down} />
              </div>
              {hasVolatility ? <VolatilityPanel snapshot={displaySnapshot} /> : null}
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 z-10 border-t border-zinc-800  backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2 px-2 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              <span className="ml-1 font-mono">{strategy?.id ?? 'n/a'}</span>
            </span>
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              <span className="ml-1 font-mono">{fmtShortJson(strategy?.params ?? null, 80)}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              indicators <span className="ml-1 font-mono">{fmtList(indEnabled)}</span>
            </span>
            <span className="chip bg-zinc-900/60 text-zinc-200 ring-zinc-800">
              external feeds <span className="ml-1 font-mono">{fmtList(feedsDataKeys)}</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}


