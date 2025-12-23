export function msUntilNextBoundary(nowMs: number, windowMs: number): number {
  const next = (Math.floor(nowMs / windowMs) + 1) * windowMs
  return Math.max(0, next - nowMs)
}

export function formatMsAsMmSs(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${String(min).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

export type WindowBoundaryScheduler = {
  start: () => void
  stop: () => void
}

/**
 * Schedules a callback to run on every window boundary (e.g. every 15 minutes),
 * aligned to wall-clock boundaries (based on Date.now()).
 */
export function createWindowBoundaryScheduler(args: {
  windowMs: number
  onBoundary: () => void
}): WindowBoundaryScheduler {
  let timer: NodeJS.Timeout | undefined
  let running = false

  const scheduleNext = (): void => {
    if (!running) return
    const delay = msUntilNextBoundary(Date.now(), args.windowMs)
    timer = setTimeout(() => {
      if (!running) return
      args.onBoundary()
      scheduleNext()
    }, delay)
  }

  return {
    start: () => {
      if (running) return
      running = true
      scheduleNext()
    },
    stop: () => {
      running = false
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}

