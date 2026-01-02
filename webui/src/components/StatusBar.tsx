import type { BotUiSnapshot } from '../types'

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

export function StatusBar(props: { snapshot: BotUiSnapshot }) {
  const s = props.snapshot.status

  return (
    <div className="panel">
      <div className="panel-h">
        <div className="panel-t">{props.snapshot.title}</div>
        <div className="text-[11px] text-zinc-500">status</div>
      </div>

      <div className="panel-b kv">
        <div className="k">symbol</div>
        <div className="v">{s.symbol}</div>

        <div className="k">slug</div>
        <div className="v">{s.slug ?? 'n/a'}</div>

        <div className="k">candle left</div>
        <div className="v">{fmtMs(s.candleLeftMs)}</div>

        <div className="k">ws attempt</div>
        <div className="v">{s.wsAttempt}</div>

        <div className="k">ws events</div>
        <div className="v">{s.wsEventsTotal}</div>
      </div>
    </div>
  )
}


