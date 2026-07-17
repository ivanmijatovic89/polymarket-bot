/**
 * Bounded-concurrency worker pool over a job queue, shared by the Binance
 * dataset CLIs (download / upload / R2 pull). Stops dequeuing when `isAborted`
 * reports true (e.g. a SIGINT handler flipped a flag) or after the first
 * rejected job; in-flight jobs always finish. Returns the first error instead
 * of throwing so callers control exit codes and summary logging.
 */
export async function runWorkerPool<T>(args: {
  jobs: readonly T[]
  concurrency: number
  isAborted?: () => boolean
  run: (job: T) => Promise<void>
}): Promise<Error | undefined> {
  const queue = [...args.jobs]
  let fatal: Error | undefined
  const worker = async (): Promise<void> => {
    while (!args.isAborted?.() && !fatal) {
      const job = queue.shift()
      if (job === undefined) return
      try {
        await args.run(job)
      } catch (err) {
        fatal ??= err instanceof Error ? err : new Error(String(err))
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, queue.length) }, worker))
  return fatal
}
