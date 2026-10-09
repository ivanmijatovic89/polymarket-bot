/**
 * Pre-start exchange-rules capture (native spec 11 §13.2.1, decision D37).
 *
 * Fetches the public Gamma and CLOB bodies of every upcoming BTC 5m/15m market
 * shortly before it starts and appends every completed attempt verbatim to a
 * daily JSONL file. It captures what cannot be recovered later and never writes
 * a database.
 *
 * PC6 code boundary: imports only Node built-ins and modules under
 * src/exchange-rules/ (no src/config, no .env, no src/db, no engine path), so it
 * changes no TS engine behaviour. Bodies are read with `arrayBuffer()` and
 * decoded losslessly; `fetchGammaRaw` is not reused because `text()` is lossy.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { buildStatus } from './prestartCoverage.js'
import {
  JsonlWriter,
  RECORD_VERSION,
  writeJsonAtomic,
  type CaptureRecord,
} from './prestartFiles.js'
import {
  ORIGINS,
  captureWindowMarkets,
  isFinalTick,
  nextTickMs,
  type GridMarket,
  type Origin,
  type Slot,
  type Timeframe,
} from './prestartGrid.js'

export const GAMMA_MARKET_URL = 'https://gamma-api.polymarket.com/markets/slug/'
export const CLOB_MARKET_URL = 'https://clob.polymarket.com/clob-markets/'
export const REQUEST_TIMEOUT_MS = 5_000
export const MAX_ATTEMPTS = 3
export const MAX_RETRY_AFTER_MS = 20_000
export const MAX_RAW_BODY_BYTES = 1024 * 1024
/** Upper bound of one sleep slice, so a long wait re-reads the wall clock. */
const MAX_SLEEP_SLICE_MS = 10_000

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>

export interface CaptureDeps {
  outDir: string
  fetch: FetchLike
  /** Host wall clock, ms since the epoch. */
  now: () => number
  /** Resolves after `ms`, or early once `signal` aborts; never rejects. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Uniform in [0, 1), for the retry jitter. */
  random: () => number
  host: string
  captureCommit: string
  timeoutMs?: number
  log?: (line: string) => void
}

// ------------------------------------------------------------- one attempt

/** Fatal, BOM-preserving decoding: re-encoding the string gives back the exact bytes. */
export function decodeRawBody(bytes: Uint8Array): { rawBody: string | null; error: string | null } {
  if (bytes.byteLength > MAX_RAW_BODY_BYTES) return { rawBody: null, error: 'body_too_large' }
  try {
    return {
      rawBody: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      error: null,
    }
  } catch {
    return { rawBody: null, error: 'invalid_utf8' }
  }
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  let text = `${error.name}: ${error.message}`
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code
    text += ` (cause: ${code ? `${code} ` : ''}${cause.message})`
  }
  return text
}

/** The `conditionId` and `slug` of a Gamma body, when it is a JSON object. */
export function parseGammaBody(rawBody: string): {
  conditionId: string | null
  slug: string | null
} {
  try {
    const value: unknown = JSON.parse(rawBody.replace(/^﻿/, ''))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { conditionId: null, slug: null }
    }
    const { conditionId, slug } = value as Record<string, unknown>
    return {
      conditionId: typeof conditionId === 'string' && conditionId !== '' ? conditionId : null,
      slug: typeof slug === 'string' ? slug : null,
    }
  } catch {
    return { conditionId: null, slug: null }
  }
}

/** `Retry-After` in ms (delta-seconds or HTTP date), or null when absent or unreadable. */
export function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs)
}

export interface CaptureRequest {
  origin: Origin
  slot: Slot
  market: GridMarket
  /** `clob`: the id requested; `gamma`: unused. */
  conditionId: string | null
}

export function requestUrl(request: CaptureRequest): string {
  return request.origin === 'gamma'
    ? `${GAMMA_MARKET_URL}${encodeURIComponent(request.market.slug)}`
    : `${CLOB_MARKET_URL}${encodeURIComponent(request.conditionId ?? '')}`
}

interface Attempt {
  record: CaptureRecord
  retryAfter: string | null
  /** A 200 whose body is stored (and, for Gamma, matches the slug and names a conditionId). */
  usable: boolean
}

export async function performAttempt(deps: CaptureDeps, request: CaptureRequest): Promise<Attempt> {
  const url = requestUrl(request)
  const requestedAtMs = deps.now()
  let httpStatus = 0
  let error: string | null = null
  let rawSha256: string | null = null
  let rawBody: string | null = null
  let retryAfter: string | null = null
  let fetchedAtMs: number
  try {
    const response = await deps.fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    fetchedAtMs = deps.now()
    httpStatus = response.status
    retryAfter = response.headers.get('retry-after')
    rawSha256 = createHash('sha256').update(bytes).digest('hex')
    ;({ rawBody, error } = decodeRawBody(bytes))
  } catch (caught) {
    fetchedAtMs = deps.now()
    httpStatus = 0
    error = describeError(caught)
  }
  let conditionId = request.origin === 'clob' ? request.conditionId : null
  let usable = httpStatus === 200 && rawBody !== null
  if (request.origin === 'gamma' && httpStatus === 200 && rawBody !== null) {
    const body = parseGammaBody(rawBody)
    conditionId = body.conditionId
    usable = body.conditionId !== null && body.slug === request.market.slug
  }
  const record: CaptureRecord = {
    v: RECORD_VERSION,
    origin: request.origin,
    slot: request.slot,
    slug: request.market.slug,
    timeframe: request.market.timeframe,
    marketStartMs: request.market.marketStartMs,
    conditionId,
    url,
    requestedAtMs,
    fetchedAtMs,
    httpStatus,
    error,
    rawSha256,
    rawBody,
    host: deps.host,
    captureCommit: deps.captureCommit,
  }
  return { record, retryAfter, usable }
}

// ------------------------------------------------------------ retry policy

export type Verdict =
  | { kind: 'ok' }
  | { kind: 'defer'; reason: string }
  | { kind: 'retry'; waitMs: number; reason: string }

/**
 * PC3: Gamma 404 and 429/5xx without a `Retry-After` of at most 20 s defer to
 * the next tick; 429/5xx with one wait for it; every other failure (transport
 * error, timeout, other statuses, an unusable 200) waits a jittered 1-3 s.
 */
export function classifyAttempt(
  origin: Origin,
  attempt: Pick<Attempt, 'record' | 'retryAfter' | 'usable'>,
  nowMs: number,
  random: () => number,
): Verdict {
  if (attempt.usable) return { kind: 'ok' }
  const status = attempt.record.httpStatus
  if (origin === 'gamma' && status === 404) {
    return { kind: 'defer', reason: 'gamma 404 (market not created yet)' }
  }
  if (status === 429 || (status >= 500 && status <= 599)) {
    const waitMs = parseRetryAfterMs(attempt.retryAfter, nowMs)
    if (waitMs === null) return { kind: 'defer', reason: `${status} without Retry-After` }
    if (waitMs > MAX_RETRY_AFTER_MS) {
      return { kind: 'defer', reason: `${status} with Retry-After ${Math.ceil(waitMs / 1_000)} s` }
    }
    return { kind: 'retry', waitMs, reason: `${status}, Retry-After ${waitMs} ms` }
  }
  const reason = status === 0 ? (attempt.record.error ?? 'transport error') : `http ${status}`
  return { kind: 'retry', waitMs: 1_000 + random() * 2_000, reason }
}

export type RequestStatus = 'ok' | 'deferred' | 'failed' | 'skipped'

export interface RequestOutcome {
  origin: Origin
  slot: Slot
  status: RequestStatus
  attempts: number
  /** Status of the last attempt; null when nothing was sent. */
  httpStatus: number | null
  detail: string
  /** Gamma: the conditionId of a usable 200. */
  conditionId: string | null
}

// ---------------------------------------------------------------- the tick

interface MarketState {
  marketStartMs: number
  conditionId: string | null
  firstOk: Record<Origin, boolean>
  finalDone: Record<Origin, boolean>
}

export interface MarketTick {
  market: GridMarket
  final: boolean
  requests: RequestOutcome[]
}

export interface TickResult {
  tickMs: number
  markets: MarketTick[]
}

/** PC3 scheduler state, in memory only: after a restart fetches repeat (the import dedups). */
export class PrestartCapture {
  private readonly states = new Map<string, MarketState>()
  private readonly writer: JsonlWriter
  private readonly log: (line: string) => void

  constructor(
    private readonly deps: CaptureDeps,
    private readonly timeframes: readonly Timeframe[],
  ) {
    this.log = deps.log ?? (() => {})
    this.writer = new JsonlWriter(deps.outDir, this.log)
  }

  /** Runs one tick at the current clock time, then replaces `status.json`. */
  async runTick(signal?: AbortSignal): Promise<TickResult> {
    const tickMs = this.deps.now()
    for (const [slug, state] of this.states) {
      if (state.marketStartMs <= tickMs) this.states.delete(slug)
    }
    const result: TickResult = { tickMs, markets: [] }
    for (const market of captureWindowMarkets(tickMs, this.timeframes)) {
      if (signal?.aborted) break
      const state = this.stateFor(market)
      const final = isFinalTick(tickMs, market.marketStartMs)
      const tick: MarketTick = { market, final, requests: [] }
      result.markets.push(tick)
      for (const origin of ORIGINS) {
        const slots: Slot[] = []
        if (!state.firstOk[origin]) slots.push('first')
        if (final && !state.finalDone[origin]) slots.push('final')
        for (const slot of slots) {
          if (signal?.aborted) break
          if (origin === 'clob' && state.conditionId === null) {
            tick.requests.push({
              origin,
              slot,
              status: 'skipped',
              attempts: 0,
              httpStatus: null,
              detail: 'no conditionId from a Gamma 200 yet',
              conditionId: null,
            })
            continue
          }
          const outcome = await this.capture(
            { origin, slot, market, conditionId: origin === 'clob' ? state.conditionId : null },
            signal,
          )
          tick.requests.push(outcome)
          if (slot === 'first' && outcome.status === 'ok') state.firstOk[origin] = true
          if (slot === 'final') state.finalDone[origin] = true
          if (origin === 'gamma' && outcome.conditionId !== null) {
            state.conditionId = outcome.conditionId
          }
        }
      }
    }
    try {
      writeJsonAtomic(
        path.join(this.deps.outDir, 'status.json'),
        buildStatus({
          outDir: this.deps.outDir,
          nowMs: this.deps.now(),
          timeframes: this.timeframes,
          host: this.deps.host,
          captureCommit: this.deps.captureCommit,
        }),
      )
    } catch (error) {
      this.log(`status.json not written: ${describeError(error)}`)
    }
    return result
  }

  /** Up to MAX_ATTEMPTS attempts inside the tick; never throws. */
  private async capture(request: CaptureRequest, signal?: AbortSignal): Promise<RequestOutcome> {
    const outcome: RequestOutcome = {
      origin: request.origin,
      slot: request.slot,
      status: 'failed',
      attempts: 0,
      httpStatus: null,
      detail: '',
      conditionId: null,
    }
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const result = await performAttempt(this.deps, request)
        outcome.attempts = attempt
        outcome.httpStatus = result.record.httpStatus
        this.writer.append(result.record)
        const verdict = classifyAttempt(request.origin, result, this.deps.now(), this.deps.random)
        if (verdict.kind === 'ok') {
          outcome.status = 'ok'
          outcome.detail = 'ok'
          outcome.conditionId = request.origin === 'gamma' ? result.record.conditionId : null
          return outcome
        }
        outcome.detail = verdict.reason
        if (verdict.kind === 'defer') {
          outcome.status = 'deferred'
          return outcome
        }
        if (attempt === MAX_ATTEMPTS || signal?.aborted) break
        await this.deps.sleep(verdict.waitMs, signal)
      }
    } catch (error) {
      outcome.detail = `capture error: ${describeError(error)}`
    }
    outcome.status = 'failed'
    return outcome
  }

  private stateFor(market: GridMarket): MarketState {
    let state = this.states.get(market.slug)
    if (state === undefined) {
      state = {
        marketStartMs: market.marketStartMs,
        conditionId: null,
        firstOk: { gamma: false, clob: false },
        finalDone: { gamma: false, clob: false },
      }
      this.states.set(market.slug, state)
    }
    return state
  }
}

// ------------------------------------------------------------- run modes

/** `--watch`: one tick per wall-clock minute at second 5, until `signal` aborts. */
export async function runWatch(
  capture: PrestartCapture,
  deps: Pick<CaptureDeps, 'now' | 'sleep'> & { onTick?: (result: TickResult) => void },
  signal: AbortSignal,
  onError: (error: unknown) => void = () => {},
): Promise<void> {
  while (!signal.aborted) {
    const target = nextTickMs(deps.now())
    for (let now = deps.now(); now < target && !signal.aborted; now = deps.now()) {
      await deps.sleep(Math.min(target - now, MAX_SLEEP_SLICE_MS), signal)
    }
    if (signal.aborted) break
    try {
      const result = await capture.runTick(signal)
      deps.onTick?.(result)
    } catch (error) {
      onError(error)
    }
  }
}

/** One log line per tick plus one per request that did not end `ok`. */
export function formatTick(result: TickResult): string[] {
  const all = result.markets.flatMap((market) => market.requests)
  const count = (status: RequestStatus): number => all.filter((r) => r.status === status).length
  const lines = [
    `tick ${new Date(result.tickMs).toISOString()}: ${result.markets.length} markets in window, ` +
      `${all.length} requests (ok ${count('ok')}, deferred ${count('deferred')}, ` +
      `failed ${count('failed')}, skipped ${count('skipped')})`,
  ]
  for (const market of result.markets) {
    for (const r of market.requests) {
      if (r.status === 'ok') continue
      lines.push(
        `  ${market.market.slug} ${r.origin}/${r.slot}: ${r.status} after ${r.attempts} attempt(s), ` +
          `last http ${r.httpStatus ?? '-'}: ${r.detail}`,
      )
    }
  }
  return lines
}

/** `--once` verdict: every market in the window got a 200 from both origins in this tick. */
export function onceVerdict(result: TickResult): { complete: boolean; lines: string[] } {
  let complete = result.markets.length > 0
  const lines: string[] = []
  for (const tick of result.markets) {
    const cells = ORIGINS.map((origin) => {
      const requests = tick.requests.filter((r) => r.origin === origin)
      const ok = requests.find((r) => r.status === 'ok')
      const last = requests.at(-1)
      if (ok === undefined) complete = false
      if (ok !== undefined) return `${origin} 200 (${ok.slot})`
      if (last === undefined) return `${origin} not requested`
      return `${origin} NO 200 (last http ${last.httpStatus ?? '-'}: ${last.detail})`
    })
    const leadS = Math.round((tick.market.marketStartMs - result.tickMs) / 1_000)
    lines.push(
      `${tick.market.slug}  starts in ${leadS} s${tick.final ? ' (final slot)' : ''}  ${cells.join('  ')}`,
    )
  }
  return { complete, lines }
}

/** `git rev-parse HEAD` of the checkout containing `dir`, or `unknown`. */
export function resolveCaptureCommit(dir: string): string {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(dir),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : 'unknown'
  } catch {
    return 'unknown'
  }
}
