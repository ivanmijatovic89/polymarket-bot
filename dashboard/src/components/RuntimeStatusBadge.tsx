import { Badge } from '@/components/ui/badge'
import type { RuntimeRunStatus } from '@/lib/runtimeTypes'

export function RuntimeStatusBadge({ status }: { status: RuntimeRunStatus }) {
  const variant =
    status === 'running' || status === 'completed'
      ? 'success'
      : status === 'waiting' || status === 'paused' || status === 'rate_limited'
        ? 'warning'
        : status === 'error'
          ? 'destructive'
          : 'muted'
  return <Badge variant={variant}>{status.replace('_', ' ')}</Badge>
}
