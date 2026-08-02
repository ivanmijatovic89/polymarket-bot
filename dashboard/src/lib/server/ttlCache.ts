export type TtlCacheRead<T> = {
  value: T
  source: 'fresh' | 'cache'
  ageMs: number
}

export type TtlCache<T> = {
  get(load: () => Promise<T>): Promise<TtlCacheRead<T>>
  clear(): void
}

/**
 * Small process-local TTL cache for dashboard data sources.
 * Concurrent misses share one loader promise so a burst only reaches the
 * upstream service once.
 */
export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error('ttlMs must be a finite non-negative number')
  }

  let cached: { value: T; storedAt: number } | null = null
  let inFlight: Promise<T> | null = null

  return {
    async get(load) {
      if (cached && now() - cached.storedAt < ttlMs) {
        return {
          value: cached.value,
          source: 'cache',
          ageMs: Math.max(0, now() - cached.storedAt),
        }
      }
      if (inFlight) return { value: await inFlight, source: 'fresh', ageMs: 0 }

      const pending = load().then((value) => {
        cached = { value, storedAt: now() }
        return value
      })
      inFlight = pending

      try {
        return { value: await pending, source: 'fresh', ageMs: 0 }
      } finally {
        if (inFlight === pending) inFlight = null
      }
    },

    clear() {
      cached = null
    },
  }
}
