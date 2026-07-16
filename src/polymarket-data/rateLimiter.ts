/**
 * Token-bucket rate limiter shared by all workers in a sync process.
 *
 * One instance per API host/endpoint budget. `acquire()` resolves when a token
 * is available; concurrent workers therefore self-throttle to a global rps
 * regardless of how many of them are running.
 */
export class RateLimiter {
  private tokens: number
  private lastRefillMs: number

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst = Math.max(1, Math.ceil(ratePerSecond)),
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    if (ratePerSecond <= 0) throw new Error('[rateLimiter] ratePerSecond must be > 0')
    this.tokens = this.burst
    this.lastRefillMs = now()
  }

  private refill(): void {
    const t = this.now()
    const elapsedMs = t - this.lastRefillMs
    if (elapsedMs <= 0) return
    this.tokens = Math.min(this.burst, this.tokens + (elapsedMs / 1000) * this.ratePerSecond)
    this.lastRefillMs = t
  }

  /** Blocks until one token is available, then consumes it. */
  async acquire(): Promise<void> {
    // Loop rather than a single wait: other callers may drain the bucket while
    // this one sleeps.
    for (;;) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      const deficit = 1 - this.tokens
      const waitMs = Math.max(1, Math.ceil((deficit / this.ratePerSecond) * 1000))
      await this.sleep(waitMs)
    }
  }
}
