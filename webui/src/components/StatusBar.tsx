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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-zinc-900/60 px-3 py-2 ring-1 ring-zinc-800">
      <div className="text-sm font-semibold text-zinc-100">{props.snapshot.title}</div>

      <div className="text-xs text-zinc-400">
        symbol <span className="font-mono text-zinc-200">{s.symbol}</span>
      </div>
      <div className="text-xs text-zinc-400">
        slug <span className="font-mono text-zinc-200">{s.slug ?? 'n/a'}</span>
      </div>
      <div className="text-xs text-zinc-400">
        candle left <span className="font-mono text-zinc-200">{fmtMs(s.candleLeftMs)}</span>
      </div>
      <div className="text-xs text-zinc-400">
        ws attempt <span className="font-mono text-zinc-200">{s.wsAttempt}</span>
      </div>
      <div className="text-xs text-zinc-400">
        ws events <span className="font-mono text-zinc-200">{s.wsEventsTotal}</span>
      </div>
    </div>
  )
}


