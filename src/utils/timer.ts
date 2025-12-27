/**
 * Simple timer utility for measuring execution time.
 */
export class Timer {
  private readonly startTime: number

  constructor() {
    this.startTime = performance.now()
  }

  /**
   * Get elapsed time in milliseconds.
   */
  elapsedMs(): number {
    return performance.now() - this.startTime
  }

  /**
   * Get elapsed time in seconds.
   */
  elapsedSeconds(): number {
    return this.elapsedMs() / 1000
  }

  /**
   * Get human-readable elapsed time string.
   * Format: "Xm Y.Zs" if over a minute, otherwise "Y.Zs"
   */
  elapsedTimeFormatted(): string {
    const elapsedMs = this.elapsedMs()
    const elapsedMinutes = Math.floor(elapsedMs / 60000)
    const remainingSeconds = ((elapsedMs % 60000) / 1000).toFixed(2)

    return elapsedMinutes > 0
      ? `${elapsedMinutes}m ${remainingSeconds}s`
      : `${remainingSeconds}s`
  }

  /**
   * Get summary object with both milliseconds and formatted time.
   */
  summary(): { elapsedMs: number; elapsedTime: string } {
    return {
      elapsedMs: Math.round(this.elapsedMs()),
      elapsedTime: this.elapsedTimeFormatted(),
    }
  }
}

