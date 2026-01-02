export type PolymarketPriceToBeatClientOptions = {
  symbol: string
  eventStartTimeIso: string
  endDateIso: string
  /**
   * Polymarket endpoint variant. User requested: `fifteen`.
   */
  variant?: 'fifteen'
  pollIntervalMs?: number
  onOpenPrice: (u: {
    symbol: string
    eventStartTimeIso: string
    endDateIso: string
    openPrice: number
    apiTimestampMs?: number
  }) => void
  onStatus?: (s: { kind: 'polling' | 'resolved' | 'stopped'; info?: string }) => void
}

export type PolymarketPriceToBeatClient = {
  start: () => void
  stop: () => void
}

type ApiResponse = {
  openPrice: number | null
  closePrice?: number | null
  timestamp?: number
  completed?: boolean
  incomplete?: boolean
  cached?: boolean
}

function asFiniteNumber(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x === 'string' && x.length > 0) {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function createPolymarketPriceToBeatClient(
  opts: PolymarketPriceToBeatClientOptions,
): PolymarketPriceToBeatClient {
  const symbol = (opts.symbol ?? '').trim()
  const eventStartTimeIso = (opts.eventStartTimeIso ?? '').trim()
  const endDateIso = (opts.endDateIso ?? '').trim()
  const variant = opts.variant ?? 'fifteen'
  const pollIntervalMs = Math.max(250, Math.trunc(opts.pollIntervalMs ?? 1000))

  if (!symbol) throw new Error('[PolymarketPriceToBeat] missing symbol')
  if (!eventStartTimeIso) throw new Error('[PolymarketPriceToBeat] missing eventStartTimeIso')
  if (!endDateIso) throw new Error('[PolymarketPriceToBeat] missing endDateIso')

  let running = false
  let timer: NodeJS.Timeout | undefined
  let inFlight = false
  let abort: AbortController | undefined
  let resolved = false

  const clear = (): void => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (abort) abort.abort()
    abort = undefined
    inFlight = false
  }

  const buildUrl = (): string => {
    const u = new URL('https://polymarket.com/api/crypto/crypto-price')
    u.searchParams.set('symbol', symbol)
    u.searchParams.set('eventStartTime', eventStartTimeIso)
    u.searchParams.set('variant', variant)
    u.searchParams.set('endDate', endDateIso)
    // Cache busting: endpoint sometimes caches; add ts each poll.
    u.searchParams.set('ts', String(Date.now()))
    return u.toString()
  }

  const tick = async (): Promise<void> => {
    if (!running) return
    if (resolved) return
    if (inFlight) return
    inFlight = true
    abort = new AbortController()

    try {
      const url = buildUrl()
      const res = await fetch(url, {
        method: 'GET',
        signal: abort.signal,
        headers: {
          accept: 'application/json',
        },
      })

      console.log('calling api url', url)


      // Endpoint can return 400s; treat as retryable.
      if (!res.ok) {
        return
      }

      const json: unknown = await res.json()
      console.log('json', json)
      const body = json as Partial<ApiResponse>
      const openPrice = asFiniteNumber(body.openPrice)
      if (openPrice === null) return

      resolved = true
      opts.onOpenPrice({
        symbol,
        eventStartTimeIso,
        endDateIso,
        openPrice,
        ...(typeof body.timestamp === 'number' && Number.isFinite(body.timestamp)
          ? { apiTimestampMs: body.timestamp }
          : {}),
      })
      opts.onStatus?.({ kind: 'resolved' })
      clear()
    } catch (err) {
      // Retry on any error (including abort / parse errors).
      void err
    } finally {
      inFlight = false
      abort = undefined
    }
  }

  return {
    start: () => {
      if (running) return
      running = true
      resolved = false
      opts.onStatus?.({
        kind: 'polling',
        info: `symbol=${symbol} eventStartTime=${eventStartTimeIso} endDate=${endDateIso} variant=${variant}`,
      })
      // Fire immediately, then every second.
      void tick()
      timer = setInterval(() => {
        void tick()
      }, pollIntervalMs)
    },
    stop: () => {
      if (!running) return
      running = false
      clear()
      opts.onStatus?.({ kind: 'stopped' })
    },
  }
}


