// Benchmark conditions and the `non-idle` label (16 §13.5).
//
// A row is `idle` only when every quiet-host condition holds: the operator
// confirms the fleet worker and Global Runtime are paused, no fleet process
// is seen, the 1-minute load average stayed < 1.0 for the 60 s before the
// start, the run starts inside the 01:00–07:00 window, the host is on AC
// power with Low Power Mode off, and every binary is canonical (01 §6). Any
// other run is `non-idle`: its numbers serve only as interleaved
// before/after pairs within one sitting, never as regression or gate
// evidence.

export type ConditionLabel = 'idle' | 'non-idle'

export interface ConditionInputs {
  /** `--quiet-host-confirmed`: fleet worker drained and Global Runtime paused. */
  quietHostConfirmed: boolean
  /** Processes of the fleet checkout or Global Runtime seen by `ps`. */
  fleetProcessCount: number
  /** 1-minute load averages sampled over the 60 s before start (empty: not sampled). */
  preStartLoad1: readonly number[]
  /** Local hour (0–23) at start. */
  startLocalHour: number
  binariesCanonical: boolean
  /** true on AC power; null when unknown. */
  acPower: boolean | null
  /** true when Low Power Mode is on; null when unknown. */
  lowPowerMode: boolean | null
}

export interface ConditionVerdict {
  label: ConditionLabel
  /** Why the run is `non-idle` (empty when idle). */
  reasons: string[]
}

export const PRE_START_SAMPLES = 13 // every 5 s over 60 s, both ends included
export const QUIET_LOAD1 = 1.0
export const WINDOW_START_HOUR = 1
export const WINDOW_END_HOUR = 7

export function classifyConditions(c: ConditionInputs): ConditionVerdict {
  const reasons: string[] = []
  if (!c.quietHostConfirmed) {
    reasons.push('quiet host not confirmed (fleet worker and Global Runtime not paused)')
  }
  if (c.fleetProcessCount > 0) {
    reasons.push(`${c.fleetProcessCount} fleet or Global Runtime process(es) running`)
  }
  if (c.preStartLoad1.length < PRE_START_SAMPLES) {
    reasons.push('no 60 s pre-start load sampling')
  } else {
    const max = Math.max(...c.preStartLoad1)
    if (!(max < QUIET_LOAD1)) {
      reasons.push(
        `1-minute load average reached ${max.toFixed(2)} before start (needs < ${QUIET_LOAD1})`,
      )
    }
  }
  if (!(c.startLocalHour >= WINDOW_START_HOUR && c.startLocalHour < WINDOW_END_HOUR)) {
    reasons.push('started outside the 01:00-07:00 benchmark window')
  }
  if (!c.binariesCanonical) reasons.push('non-canonical binary (not a canonical artifact build)')
  if (c.acPower !== true)
    reasons.push(c.acPower === null ? 'power source unknown' : 'not on AC power')
  if (c.lowPowerMode !== false) {
    reasons.push(c.lowPowerMode === null ? 'Low Power Mode state unknown' : 'Low Power Mode on')
  }
  return { label: reasons.length === 0 ? 'idle' : 'non-idle', reasons }
}

/**
 * Processes of the fleet checkout (`…/Sites/polymarket-bot/…`, never the
 * `-native` clone), the backtest worker or Global Runtime in
 * `ps -Ao pid=,args=` output, excluding `selfPid`.
 */
export function countFleetProcesses(psText: string, selfPid: number): number {
  let n = 0
  for (const line of psText.split('\n')) {
    const m = /^\s*([0-9]+)\s+(.*)$/.exec(line)
    if (!m || m[1] === undefined || m[2] === undefined) continue
    if (Number(m[1]) === selfPid) continue
    const args = m[2]
    if (
      /\/Sites\/polymarket-bot\//.test(args) ||
      /worker:markets|worker:aggregate|global-runtime/.test(args)
    )
      n++
  }
  return n
}
