/**
 * Semaphore for controlling concurrent async operations.
 * Limits the number of operations that can run simultaneously.
 */
export class Semaphore {
  private permits: number
  private queue: (() => void)[] = []

  constructor(permits: number) {
    if (permits <= 0) {
      throw new Error('Semaphore permits must be greater than 0')
    }
    this.permits = permits
  }

  /**
   * Acquire a permit. If no permits are available, waits until one is released.
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  /**
   * Release a permit. If there are waiters in the queue, resolves the next one.
   */
  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift()!
      resolve()
    } else {
      this.permits++
    }
  }

  /**
   * Get the number of available permits.
   */
  available(): number {
    return this.permits
  }

  /**
   * Get the number of waiters in the queue.
   */
  waiting(): number {
    return this.queue.length
  }
}
