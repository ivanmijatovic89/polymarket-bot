import type { BotUiSnapshot } from '../types'

function fmtAge(nowMs: number | undefined, receivedAtMs: number | undefined): string {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return 'n/a'
  if (typeof receivedAtMs !== 'number' || !Number.isFinite(receivedAtMs)) return 'n/a'
  const ms = Math.max(0, nowMs - receivedAtMs)
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

function fmtNum(n: unknown, opts?: Intl.NumberFormatOptions): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a'
  return n.toLocaleString('en-US', opts)
}

type Row = {
  label: string
  symbol?: string
  value?: string
  age?: string
}

export function ExternalFeedsPanel(props: { snapshot: BotUiSnapshot }) {
  const nowMs = props.snapshot.nowMs
  const feeds = (props.snapshot as unknown as { feeds?: any }).feeds

  const rows: Row[] = []

  const rtdsBinance = feeds?.rtdsPolymarketCryptoPrices?.binance
  if (rtdsBinance) {
    rows.push({
      label: 'RTDS Binance',
      symbol: typeof rtdsBinance.symbol === 'string' ? rtdsBinance.symbol : undefined,
      value: fmtNum(rtdsBinance.value, { maximumFractionDigits: 2 }),
      age: fmtAge(nowMs, rtdsBinance.receivedAtMs),
    })
  }

  const rtdsChainlink = feeds?.rtdsPolymarketCryptoPrices?.chainlink
  if (rtdsChainlink) {
    rows.push({
      label: 'RTDS Chainlink',
      symbol: typeof rtdsChainlink.symbol === 'string' ? rtdsChainlink.symbol : undefined,
      value: fmtNum(rtdsChainlink.value, { maximumFractionDigits: 2 }),
      age: fmtAge(nowMs, rtdsChainlink.receivedAtMs),
    })
  }

  const binanceWs = feeds?.binanceWsSpotPrice
  if (binanceWs) {
    rows.push({
      label: 'Binance WS',
      symbol: typeof binanceWs.symbol === 'string' ? binanceWs.symbol : undefined,
      value: fmtNum(binanceWs.value, { maximumFractionDigits: 2 }),
      age: fmtAge(nowMs, binanceWs.receivedAtMs),
    })
  }

  const ptb = feeds?.polymarketPriceToBeat
  if (ptb) {
    rows.push({
      label: 'PriceToBeat',
      symbol: typeof ptb.symbol === 'string' ? ptb.symbol : undefined,
      value: fmtNum(ptb.openPrice, { maximumFractionDigits: 2 }),
      age: fmtAge(nowMs, ptb.receivedAtMs),
    })
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[17px] font-semibold">external feeds</div>
        <div className="text-[14px] text-zinc-500">{rows.length} active</div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md bg-zinc-900/40 p-3 text-[16px] text-zinc-400 ring-1 ring-zinc-800">
          no feed data yet
        </div>
      ) : (
        <div className="rounded-md bg-zinc-900/40 ring-1 ring-zinc-800">
          <div className="grid grid-cols-[180px_1fr_140px] gap-2 border-b border-zinc-800 px-3 py-2 text-[14px] text-zinc-400">
            <div>source</div>
            <div>symbol / value</div>
            <div className="text-right">age</div>
          </div>
          <div className="text-[16px]">
            {rows.map((r, idx) => (
              <div key={idx} className="grid grid-cols-[180px_1fr_140px] gap-2 px-3 py-2">
                <div className="text-zinc-200">{r.label}</div>
                <div className="font-mono text-zinc-200">
                  {r.symbol ? <span className="text-zinc-400">{r.symbol} </span> : null}
                  <span>{r.value ?? 'n/a'}</span>
                </div>
                <div className="text-right font-mono text-zinc-300">{r.age ?? 'n/a'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


