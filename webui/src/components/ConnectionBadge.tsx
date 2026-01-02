import type { WsStatus } from '../hooks/useBotWs'

export function ConnectionBadge(props: { status: WsStatus }) {
  const { status } = props
  const style =
    status === 'open'
      ? 'bg-emerald-950 text-emerald-200 ring-1 ring-emerald-900'
      : status === 'connecting'
        ? 'bg-amber-950 text-amber-200 ring-1 ring-amber-900'
        : status === 'error'
          ? 'bg-red-950 text-red-200 ring-1 ring-red-900'
          : 'bg-zinc-900 text-zinc-200 ring-1 ring-zinc-800'

  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${style}`}>
      ws: {status}
    </span>
  )
}


