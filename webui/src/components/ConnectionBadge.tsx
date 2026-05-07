import type { WsStatus } from '../hooks/useBotWs'

export function ConnectionBadge(props: { status: WsStatus; attempt?: number }) {
  const { status, attempt } = props
  const style =
    status === 'open'
      ? 'bg-emerald-950 text-emerald-200 ring-emerald-900'
      : status === 'connecting'
        ? 'bg-amber-950 text-amber-200 ring-amber-900'
        : status === 'error'
          ? 'bg-red-950 text-red-200 ring-red-900'
          : 'bg-zinc-900 text-zinc-200 ring-zinc-800'

  return (
    <span className={`chip ring-1 ${style}`}>
      ws: {status}
      {typeof attempt === 'number' ? <span className="ml-1 font-mono">{attempt}</span> : null}
    </span>
  )
}
