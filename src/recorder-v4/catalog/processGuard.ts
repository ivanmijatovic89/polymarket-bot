/** Bounds this independent CLI only; shared trading/database behavior is unchanged. */
export class CatalogProcessGuard {
  private readonly abort = new AbortController()
  private shutdownTimer: NodeJS.Timeout | undefined
  readonly signal = this.abort.signal

  stop(failed = false): void {
    if (failed) process.exitCode = 1
    if (this.shutdownTimer) return
    // mysql2 cannot cancel an in-flight query with AbortSignal. If cleanup also
    // stalls, terminate this catalog process so launchd can restart it. Never
    // retry an outstanding write in the same process after its deadline.
    this.shutdownTimer = setTimeout(() => {
      console.error(
        '[recorder-catalog] shutdown exceeded 5 seconds; exiting for supervisor recovery',
      )
      process.exit(1)
    }, 5_000)
    this.shutdownTimer.unref()
    this.abort.abort()
  }

  async database<T>(operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted()
    let timer: NodeJS.Timeout | undefined
    let onAbort: (() => void) | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(this.signal.reason)
          this.signal.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(() => {
            console.error('[recorder-catalog] database operation exceeded 30 seconds; stopping')
            this.stop(true)
          }, 30_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (onAbort) this.signal.removeEventListener('abort', onAbort)
    }
  }

  finished(): void {
    clearTimeout(this.shutdownTimer)
  }
}
