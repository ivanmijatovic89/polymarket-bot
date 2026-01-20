import { useEffect, useRef, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge'
import { ExternalFeedsPanel } from './components/ExternalFeedsPanel'
import { LogsPanel } from './components/LogsPanel'
import { OrderbookDepthsPanel } from './components/OrderbookDepthsPanel'
import { OrderbookMetricsPanel } from './components/OrderbookMetricsPanel'
import { OrderbooksPanel } from './components/OrderbooksPanel'
import { OrderbooksWithDepthsAndMetricsPanel } from './components/OrderbooksWithDepthsAndMetricsPanel'
import {
  ExecutedOrdersTablePanel,
  OpenOrdersTablePanel,
  OrdersByClientIdTablePanel,
  PositionsTablePanel,
} from './components/PortfolioPanels'
import { VolatilityPanel } from './components/VolatilityPanel'
import { DwellGateStatus } from './components/DwellGateStatus'
import { useBotWs } from './hooks/useBotWs'
import { fmtCents } from './utils/format'

const CANDLE_MS_15M = 15 * 60 * 1000

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function bestAskFromBook(book?: { bestAsk?: number; asks?: Array<{ price: number }> }): number | null {
  const a = book?.bestAsk
  if (typeof a === 'number' && Number.isFinite(a) && a > 0) return a

  // Fallback: if bestAsk is missing, pull it from level 1 ask.
  // NOTE: asks are sorted ASC with best ask first.
  const lvl0 = book?.asks?.[0]?.price
  if (typeof lvl0 === 'number' && Number.isFinite(lvl0) && lvl0 > 0) return lvl0

  // No offers (or invalid)
  return null
}

function computeUpDownSplitFromAsks(
  asks: { up: number | null; down: number | null },
): { up: number; down: number; winner: 'UP' | 'DOWN' | 'NONE' } {
  const u = typeof asks.up === 'number' && Number.isFinite(asks.up) && asks.up > 0 ? asks.up : 0
  const d = typeof asks.down === 'number' && Number.isFinite(asks.down) && asks.down > 0 ? asks.down : 0
  const sum = u + d

  // Edge cases:
  // - No asks on both sides => neutral 50/50
  // - No asks on one side => 0/100 (full bar to the side with offers)
  if (sum <= 0) return { up: 50, down: 50, winner: 'NONE' }
  if (u <= 0) return { up: 0, down: 100, winner: 'DOWN' }
  if (d <= 0) return { up: 100, down: 0, winner: 'UP' }

  const up = Math.max(0, Math.min(100, (u / sum) * 100))
  const down = 100 - up
  const winner = up > down ? 'UP' : down > up ? 'DOWN' : 'NONE'
  return { up, down, winner }
}

function adjustAsksForEndOfMarket(upAskRaw: number | null, downAskRaw: number | null): {
  up: number | null
  down: number | null
} {
  const u = typeof upAskRaw === 'number' && Number.isFinite(upAskRaw) && upAskRaw > 0 ? upAskRaw : null
  const d = typeof downAskRaw === 'number' && Number.isFinite(downAskRaw) && downAskRaw > 0 ? downAskRaw : null

  // Only apply the "missing => 100¢" rule when the missing side is inferred to be the winner.
  // Heuristic: if the other side's ask is below ~50¢, the missing side is likely near 100¢.
  const THRESH = 0.5

  if (u == null && d != null) {
    // Missing UP: only force UP=1.0 if DOWN is priced low (=> UP likely winner).
    return { up: d <= THRESH ? 1 : null, down: d }
  }
  if (d == null && u != null) {
    // Missing DOWN: only force DOWN=1.0 if UP is priced low (=> DOWN likely winner).
    return { up: u, down: u <= THRESH ? 1 : null }
  }
  return { up: u, down: d }
}

function computeSplitBar(upAsk: number | null, downAsk: number | null): { up: number; down: number; winner: 'UP' | 'DOWN' | 'NONE' } {
  const adj = adjustAsksForEndOfMarket(upAsk, downAsk)
  return computeUpDownSplitFromAsks({ up: adj.up, down: adj.down })
}

function TimeBar(props: { candleLeftMs?: number; topPx: number; bottomPx: number; timeWindowGate?: any }) {
  const leftRaw =
    typeof props.candleLeftMs === 'number' && Number.isFinite(props.candleLeftMs) ? props.candleLeftMs : NaN
  const left = Number.isFinite(leftRaw) ? clamp(leftRaw, 0, CANDLE_MS_15M) : NaN
  const remainingPct = Number.isFinite(left) ? (left / CANDLE_MS_15M) * 100 : 0

  return (
    <div
      className={`pm-timebar`}
      style={{ top: `${props.topPx}px`, bottom: `${props.bottomPx}px` }}
      title={Number.isFinite(left) ? `${Math.round(left / 1000)}s left` : 'time n/a'}
    >
      <div className="pm-timebar-track">
        <div className={`pm-timebar-remaining`} style={{ height: `${remainingPct}%` }} />
      </div>
    </div>
  )
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
  const feeds = s?.plugins?.externalFeeds
  const out: string[] = []
  // Check for actual values, not just object existence
  if (feeds?.rtdsPolymarketCryptoPrices?.binance?.value != null) out.push('rtds:binance')
  if (feeds?.rtdsPolymarketCryptoPrices?.chainlink?.value != null) out.push('rtds:chainlink')
  if (feeds?.binanceWsSpotPrice?.value != null) out.push('binance_ws')
  if (feeds?.polymarketPriceToBeat?.openPrice != null) out.push('price_to_beat')
  return out
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

function makeMockPortfolio(snapshot: any): { portfolio: any; metrics: any } {
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
  const metrics = {
    ...(snapshot?.metrics && typeof snapshot.metrics === 'object' ? snapshot.metrics : {}),
    position: positionMetrics,
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

  return { portfolio, metrics }
}

export function App() {
  const { status, snapshot, logLines, sendCommand } = useBotWs()
  const mockPortfolioEnabled = new URLSearchParams(window.location.search).has('mockPortfolio')
  const displaySnapshot =
    snapshot && mockPortfolioEnabled ? ({ ...snapshot, ...makeMockPortfolio(snapshot) } as any) : snapshot

  // "Real" asks used throughout the UI (header price chips, etc).
  const upAsk = displaySnapshot ? bestAskFromBook(displaySnapshot.books.up) : null
  const downAsk = displaySnapshot ? bestAskFromBook(displaySnapshot.books.down) : null
  const strategy = displaySnapshot?.strategy
  const pluginIds = (() => {
    const p = (displaySnapshot as any)?.plugins
    return p && typeof p === 'object' ? Object.keys(p).sort() : []
  })()
  const feedsDataKeys = displaySnapshot ? feedKeysFromData(displaySnapshot) : []
  const hasVolatility = Boolean((displaySnapshot as any)?.plugins?.timeWindowVolatility)
  const timeWindowGate = (displaySnapshot as any)?.plugins?.timeWindowGate
  const dwellGate = (displaySnapshot as any)?.plugins?.dwellGate
  // Split bar above header: apply end-of-market adjustment (missing side => 100¢) ONLY here.
  const pm15m = computeSplitBar(upAsk, downAsk)
  const pm15mWinnerClass =
    pm15m.winner === 'UP' ? 'winner-up' : pm15m.winner === 'DOWN' ? 'winner-down' : 'winner-none'

  const headerWrapRef = useRef<HTMLDivElement | null>(null)
  const footerRef = useRef<HTMLElement | null>(null)
  const [chrome, setChrome] = useState({ topPx: 0, bottomPx: 0 })
  const [showOther, setShowOther] = useState(false)

  useEffect(() => {
    const update = () => {
      const topPx = headerWrapRef.current?.getBoundingClientRect().height ?? 0
      const bottomPx = footerRef.current?.getBoundingClientRect().height ?? 0
      setChrome({ topPx, bottomPx })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return (
    <div className="min-h-screen">
      <div ref={headerWrapRef} className="sticky top-0 z-10">
        {/* Polymarket BTC 15m UP/DOWN status bar (split indicator) */}
        <div className={`pm-btc15m-bar ${pm15mWinnerClass}`}>
          <div className="up-segment" style={{ width: `${pm15m.up}%` }} />
          <div className="down-segment" style={{ width: `${pm15m.down}%` }} />
        </div>

        <header className="border-b border-zinc-800  backdrop-blur">
          <div className="mx-auto max-w-[1800px] px-2 py-2">
            {/* Responsive header layout:
              - mobile: stacked sections (price remains centered)
              - tablet/desktop: 3-zone grid where center price stays EXACTLY centered
            */}
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
              {/* Left */}
              <div className="flex min-w-0 flex-wrap items-center justify-start gap-2">
                {displaySnapshot ? (
                  <span className="chip text-[18px] sm:text-[22px] bg-zinc-900/60 text-zinc-200 ring-zinc-800">
                    <span className="cursor-help" title={`${timeWindowGate?.allowAfterMs && timeWindowGate?.disableAfterMs ? `allow after ${fmtMs(timeWindowGate?.allowAfterMs)} - disable after ${fmtMs(timeWindowGate?.disableAfterMs)}` : ''}`}>
                      {timeWindowGate?.withinWindow ? '🟢' : '🔴'}
                    </span>
                    <span className="ml-3 font-mono">{fmtMs(displaySnapshot.status.candleLeftMs)}</span>
                  </span>
                ) : null}
                <div className="text-sm font-semibold text-zinc-100">polymarket-bot</div>
                <ConnectionBadge status={status} />
                <DwellGateStatus dwellGate={dwellGate} />
              </div>

              {/* Center (always centered) */}
              <div className="flex min-w-0 flex-wrap items-center justify-center justify-self-center">
                <div className="flex">
                  <div className="flex ring-1 bg-green-600/80 ring-green-500/30 font-mono text-[18px] sm:text-[22px] text-white px-4 sm:px-10 py-2 sm:py-3 rounded-md rounded-r-none">
                    <span className="text-white whitespace-nowrap">{fmtCents(upAsk, { fixed: true, digits: 2 })} ¢</span>
                  </div>
                  <div className="flex ring-1 bg-red-600/80 ring-red-500/30 font-mono text-[18px] sm:text-[22px] text-white px-4 sm:px-10 py-2 sm:py-3 rounded-md rounded-l-none">
                    <span className="text-white whitespace-nowrap">{fmtCents(downAsk, { fixed: true, digits: 2 })} ¢</span>
                  </div>
                </div>
              </div>

              {/* Right */}
              <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
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
          </div>
        </header>
      </div>

      <TimeBar candleLeftMs={displaySnapshot?.status?.candleLeftMs} topPx={chrome.topPx} bottomPx={chrome.bottomPx} timeWindowGate={timeWindowGate}/>

      <main className="mx-auto  px-2 py-2 pb-16 pm-timebar-safe">
        {!displaySnapshot ? (
          <div className="panel panel-b text-zinc-300">waiting for snapshot…</div>
        ) : (
          <div className="space-y-2">
            {/* Full-width row under header - only show if there are external feeds */}
            {feedsDataKeys.length > 0 && <ExternalFeedsPanel snapshot={displaySnapshot} />}

            {/* Full-width: portfolio + orders */}
            <div className="space-y-2">
              <PositionsTablePanel snapshot={displaySnapshot} showOther={showOther} onToggleShowOther={() => setShowOther((v) => !v)} />
              <OpenOrdersTablePanel snapshot={displaySnapshot} sendCommand={sendCommand} showOther={showOther} />
              <ExecutedOrdersTablePanel snapshot={displaySnapshot} showOther={showOther} />
              <OrdersByClientIdTablePanel snapshot={displaySnapshot} showOther={showOther} />
            </div>


            <div className="space-y-2">
            <LogsPanel logLines={logLines} />
            </div>

            <div className="space-y-2 min-w-0">

              <OrderbooksWithDepthsAndMetricsPanel
                snapshot={displaySnapshot}
                up={displaySnapshot.books.up}
                down={displaySnapshot.books.down}
              />
              {/* <div className="grid grid-cols-1 gap-2 min-w-0 xl:grid-cols-2 2xl:grid-cols-3">
                <OrderbooksPanel up={displaySnapshot.books.up} down={displaySnapshot.books.down} />
                <OrderbookDepthsPanel up={displaySnapshot.books.up} down={displaySnapshot.books.down} />
                <OrderbookMetricsPanel snapshot={displaySnapshot} />
              </div> */}
              {hasVolatility ? <VolatilityPanel snapshot={displaySnapshot} /> : null}
            </div>
          </div>
        )}
      </main>

      <footer ref={footerRef} className="fixed bottom-0 left-0 right-0 z-10 border-t border-zinc-800  backdrop-blur">
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
              plugins <span className="ml-1 font-mono">{fmtList(pluginIds)}</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  )
}


