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
  accent?: 'cyan' | 'amber' | 'emerald' | 'fuchsia'
}

export function ExternalFeedsPanel(props: { snapshot: BotUiSnapshot }) {
  const feeds = (props.snapshot as unknown as { feeds?: any }).feeds

  const tiles: Tile[] = []

  const ptb = feeds?.polymarketPriceToBeat
  tiles.push({
    label: 'Price to Beat',
    symbol: typeof ptb?.symbol === 'string' ? ptb.symbol : undefined,
    value: ptb ? fmtNum(ptb.openPrice, { maximumFractionDigits: 2 }) : 'n/a',
    accent: 'amber',
  })

  const rtdsChainlink = feeds?.rtdsPolymarketCryptoPrices?.chainlink
  tiles.push({
    label: 'Current price',
    hoverLabel: 'RTDS Chainlink',
    symbol: typeof rtdsChainlink?.symbol === 'string' ? rtdsChainlink.symbol : undefined,
    value: rtdsChainlink ? fmtNum(rtdsChainlink.value, { maximumFractionDigits: 2 }) : 'n/a',
    accent: 'cyan',
  })

  const rtdsBinance = feeds?.rtdsPolymarketCryptoPrices?.binance
  tiles.push({
    label: '(RTDS Binance)',
    hoverLabel: 'RTDS Binance',
    symbol: typeof rtdsBinance?.symbol === 'string' ? rtdsBinance.symbol : undefined,
    value: rtdsBinance ? fmtNum(rtdsBinance.value, { maximumFractionDigits: 2 }) : 'n/a',
    accent: 'emerald',
  })

  const binanceWs = feeds?.binanceWsSpotPrice
  tiles.push({
    label: '(Binance WS)',
    hoverLabel: 'Binance WS',
    symbol: typeof binanceWs?.symbol === 'string' ? binanceWs.symbol : undefined,
    value: binanceWs ? fmtNum(binanceWs.value, { maximumFractionDigits: 2 }) : 'n/a',
    accent: 'fuchsia',
  })

  const accentClass = (a: Tile['accent']): string => {
    if (a === 'amber') return 'text-amber-200'
    if (a === 'cyan') return 'text-cyan-200'
    if (a === 'emerald') return 'text-emerald-200'
    if (a === 'fuchsia') return 'text-fuchsia-200'
    return 'text-zinc-200'
  }

  return (
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
        {tiles.map((t, idx) => (
          <div key={idx} className="rounded-md bg-zinc-900/40 px-3 py-2 ring-1 ring-zinc-800">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[14px] text-zinc-400" title={t.hoverLabel ?? t.label}>
                {t.label}
              </div>
              {t.symbol ? <div className="text-[12px] font-mono text-zinc-500">{t.symbol}</div> : null}
            </div>
            <div className={`mt-1 font-mono text-[18px] ${accentClass(t.accent)}`}>{t.value ?? 'n/a'}</div>
          </div>
        ))}
      </div>
  )
}


