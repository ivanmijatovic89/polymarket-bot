/**
 * Deadlock-safe transaction retry.
 *
 * Concurrent workers writing different markets still deadlock in InnoDB: under
 * REPEATABLE READ, inserts take next-key/gap locks on secondary indexes, and
 * those gaps overlap across markets (the same wallets recur in many markets). We
 * measured this immediately at concurrency 2 — `ER_LOCK_DEADLOCK` (1213) on the
 * multi-chunk insert.
 *
 * A deadlock is not an error condition, it's InnoDB picking a victim: the losing
 * transaction is rolled back cleanly and simply has to run again. Since every
 * writer here is a whole-market replace (delete + insert + status update), a
 * retry is exactly equivalent to the first attempt.
 *
 * `mysql2` errors reach us wrapped by drizzle, so the code can sit on `cause`.
 */

export function isDeadlock(err: unknown): boolean {
  const e = err as {
    code?: string
    errno?: number
    cause?: { code?: string; errno?: number }
  }
  if (e?.code === 'ER_LOCK_DEADLOCK' || e?.errno === 1213) return true
  if (e?.cause?.code === 'ER_LOCK_DEADLOCK' || e?.cause?.errno === 1213) return true
  // Lock wait timeout: same story, the transaction can just be replayed.
  if (e?.code === 'ER_LOCK_WAIT_TIMEOUT' || e?.errno === 1205) return true
  if (e?.cause?.code === 'ER_LOCK_WAIT_TIMEOUT' || e?.cause?.errno === 1205) return true
  return false
}

const MAX_ATTEMPTS = 5

/**
 * Run `fn`, retrying it from scratch when InnoDB rolls it back as a deadlock
 * victim. Backoff is exponential with jitter so the same two workers don't
 * collide again in lockstep.
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, label = '[db]'): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isDeadlock(err) || attempt >= MAX_ATTEMPTS) throw err
      const base = 25 * 2 ** (attempt - 1)
      const waitMs = base + Math.floor(Math.random() * base)
      console.warn(`${label} deadlock; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${waitMs}ms`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
}
