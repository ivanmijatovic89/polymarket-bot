import type { BotUiSnapshot } from '../types'

function fmtNum(n: unknown, opts?: Intl.NumberFormatOptions): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toLocaleString('en-US', opts)
}

type Tile = {
  label: string
  hoverLabel?: string
  symbol?: string
  value?: string
  diff?: string
  accent?: 'cyan' | 'amber' | 'emerald' | 'fuchsia' | 'yellow' | 'orange' | 'silver'
}

export function ExternalFeedsPanel(props: { snapshot: BotUiSnapshot }) {
  const feeds = (props.snapshot as unknown as { plugins?: any }).plugins?.externalFeeds

  const tiles: Tile[] = []

  const ptb = feeds?.polymarketPriceToBeat
  tiles.push({
    label: 'Price to Beat',
    symbol: typeof ptb?.symbol === 'string' ? ptb.symbol : undefined,
    value: ptb ? fmtNum(ptb.openPrice, { maximumFractionDigits: 2 }) : 'n/a',
    accent: 'cyan',
  })

  const rtdsChainlink = feeds?.rtdsPolymarketCryptoPrices?.chainlink
  tiles.push({
    label: 'Current price',
    hoverLabel: 'RTDS PolymarketChainlink',
    symbol: 'vs Price to Beat',
    diff:
      feeds?.polymarketPriceToBeat && rtdsChainlink?.value != null
        ? fmtNum(rtdsChainlink.value - feeds.polymarketPriceToBeat.openPrice, {
            maximumFractionDigits: 0,
          })
        : 'n/a',
    value:
      rtdsChainlink?.value != null
        ? fmtNum(rtdsChainlink.value, { maximumFractionDigits: 2 })
        : 'n/a',
    accent: 'yellow',
  })

  const rtdsBinance = feeds?.rtdsPolymarketCryptoPrices?.binance
  tiles.push({
    label: 'RTDS Polymarket Binance',
    hoverLabel: 'RTDS Polymarket Binance',
    symbol: 'vs Current Price',
    diff:
      rtdsBinance?.value != null && rtdsChainlink?.value != null
        ? fmtNum(rtdsBinance.value - rtdsChainlink.value, { maximumFractionDigits: 0 })
        : 'n/a',
    value:
      rtdsBinance?.value != null ? fmtNum(rtdsBinance.value, { maximumFractionDigits: 2 }) : 'n/a',
    accent: 'orange',
  })

  const binanceWs = feeds?.binanceWsSpotPrice
  tiles.push({
    label: 'RTDS Binance',
    hoverLabel: 'RTDS Binance',
    symbol: 'VS RTDS Polymarket Binance',
    diff:
      binanceWs?.value != null && rtdsBinance?.value != null
        ? fmtNum(binanceWs.value - rtdsBinance.value, { maximumFractionDigits: 0 })
        : 'n/a',
    value: binanceWs?.value != null ? fmtNum(binanceWs.value, { maximumFractionDigits: 2 }) : 'n/a',
    accent: 'orange',
  })

  const accentClass = (a: Tile['accent']): string => {
    if (a === 'amber') return 'text-amber-200'
    if (a === 'cyan') return 'text-cyan-200'
    if (a === 'emerald') return 'text-emerald-200'
    if (a === 'fuchsia') return 'text-fuchsia-200'
    if (a === 'yellow') return 'text-yellow-500'
    if (a === 'silver') return 'text-silver-500'
    if (a === 'orange') return 'text-orange-500'
    return 'text-zinc-200'
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t, idx) => (
        <div key={idx} className="min-w-0 rounded-md bg-zinc-900/40 px-3 py-2 ring-1 ring-zinc-800">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div
                className="text-[12px] sm:text-[14px] text-zinc-400"
                title={t.hoverLabel ?? t.label}
              >
                {t.label}
              </div>
            </div>
            {t.symbol ? (
              <div className="shrink-0 text-[11px] sm:text-[12px] font-mono text-zinc-500">
                {t.symbol}
              </div>
            ) : null}
          </div>

          <div className="mt-1 flex items-end justify-between gap-2">
            <div
              className={`min-w-0 font-mono text-[16px] sm:text-[18px] ${accentClass(t.accent)}`}
            >
              <span className="block whitespace-nowrap">{t.value ?? 'n/a'}</span>
            </div>
            {t.diff ? (
              <div
                className={`shrink-0 whitespace-nowrap font-mono tabular-nums text-[13px] sm:text-[16px] ${
                  t.diff === '0' || t.diff === '-0'
                    ? 'text-zinc-500'
                    : t.diff.startsWith('-')
                      ? 'text-red-500'
                      : 'text-green-500'
                }`}
              >
                {t.diff.startsWith('-') ? '' : '+'}
                {t.diff}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
