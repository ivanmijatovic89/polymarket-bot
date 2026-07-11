import type { BadgeProps } from '@/components/ui/badge'

/**
 * Mirrors `AGGREGATE_JOB_OPTS.attempts` in `src/backtest/queue.ts`. Kept as a
 * local constant because the dashboard package doesn't import from the bot's
 * `src/`; if that value changes, update this too.
 */
const MAX_AGGREGATE_ATTEMPTS = 3

export type BatchPhase = {
  /** Human-readable status shown in the badge. */
  label: string
  variant: NonNullable<BadgeProps['variant']>
  /** Tooltip text exposing the raw BullMQ state for debugging. */
  title: string
}

/**
 * Translates the aggregate parent job's raw BullMQ state (+ child counts and
 * retry attempts) into a friendly, phase-oriented status instead of leaking
 * BullMQ's internal vocabulary (`waiting-children` / `delayed` / ...).
 *
 * Phases:
 *  - markets still processing        → "Running"
 *  - all markets done, being written → "Aggregating…"
 *  - all markets done, queued        → "Queued to aggregate"
 *  - all markets done, delayed       → "Waiting for worker" (first pass) or
 *                                       "Retrying (n/3)" (after a failed attempt)
 *
 * Pure — safe to reuse on the batch-detail page.
 */
export function deriveBatchPhase(b: {
  activeChildren: number
  waitingChildren: number
  failedChildren: number
  parentState: string | undefined
  attemptsMade: number
}): BatchPhase {
  const raw = b.parentState ?? '?'
  const title =
    `BullMQ state: ${raw}` +
    (b.attemptsMade > 0 ? ` · attempt ${b.attemptsMade}/${MAX_AGGREGATE_ATTEMPTS}` : '')
  const failedSuffix = b.failedChildren > 0 ? ` · ${b.failedChildren} failed` : ''
  const childrenDone = b.activeChildren === 0 && b.waitingChildren === 0

  // Market children still in flight (progress < 100%).
  if (!childrenDone) {
    return {
      label: `Running${failedSuffix}`,
      variant: b.failedChildren > 0 ? 'warning' : 'default',
      title,
    }
  }

  // All market children processed — the aggregate (finalization) phase.
  switch (raw) {
    case 'active':
    // `waiting-children` with zero pending children is the transient tick just
    // before BullMQ promotes the parent — treat it as aggregation imminent.
    case 'waiting-children':
      return { label: `Aggregating…${failedSuffix}`, variant: 'warning', title }
    case 'waiting':
      return { label: `Queued to aggregate${failedSuffix}`, variant: 'muted', title }
    case 'delayed':
      if (b.attemptsMade > 0) {
        return {
          label: `Retrying (${b.attemptsMade}/${MAX_AGGREGATE_ATTEMPTS})${failedSuffix}`,
          variant: 'destructive',
          title,
        }
      }
      return { label: `Waiting for worker${failedSuffix}`, variant: 'warning', title }
    default:
      return { label: `${raw}${failedSuffix}`, variant: 'secondary', title }
  }
}
