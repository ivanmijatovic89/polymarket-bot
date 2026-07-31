/**
 * fillprobe.ts — E-024 HF maker-capture fill probe (Phase 0, measurement only).
 * Pre-registered BEFORE this tool existed: memory/experiments/hf-fill-probe.md
 * (session 11, commit 59775fb). Read-only: DB for market rows, local
 * delta-typed parquet for books.
 *
 * Per pinned market and per side (UP and DOWN independently), simulates a
 * hypothetical quoter that ALWAYS rests one 10-share bid at the current
 * bestBid — no inventory limits, no budget, no refractory (a capture CEILING,
 * not a strategy). Two latency variants:
 *   0ms   — the quote follows bestBid instantly and re-arms instantly after
 *           a fill (physically unreachable bound);
 *   140ms — reprice/re-arm happens 140 ms after the triggering event, priced
 *           at the bestBid prevailing at re-quote time (deployable bound).
 * Two frozen fill models on the same event stream:
 *   W (worst-queue, the engine's rule): the resting bid at P fills whole when
 *     a post-event bestAsk < P.
 *   O (optimistic front-of-queue): W's rule PLUS — whenever the DISPLAYED
 *     size at price level P on the bid side DECREASES while P is the
 *     pre-event bestBid, the decrease is treated as executed volume and
 *     captured up to min(decrease, remaining). Over-counts cancels by design:
 *     a strict UPPER bound on any real queue position. A repriced order is a
 *     new order (remaining resets to 10).
 * Independently, the raw level-decrease flow at the pre-event bestBid is
 * counted per market (events + volume) — the "how much maker volume exists at
 * top-of-book at all" ceiling, comparable to the 700-trades/window figure.
 *
 * Window: the full 15-minute market window [slugEpoch, slugEpoch+15min).
 * Pre-window events only establish book state.
 *
 * Frozen verdict (0ms shares, aggregate over the pinned 800):
 *   O <= 2x W  -> fill model NOT binding (fill-limited is a market fact);
 *   O >= 3x W  -> fill model MATERIALLY binding (queue-aware fill model or
 *                 live micro-validation required BEFORE any HF strategy code);
 *   between    -> report, no verdict.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/fillprobe.ts [--latest 800]
 *     [--to-ms 1784762100000] [--max-markets N]
 *     [--checkpoint <file.jsonl>] [--time-budget-s N]
 *
 * --checkpoint / --time-budget-s follow bookscan.ts: one JSONL line per
 * scanned market, params header enforced, {"partial":true,...} + exit 0 when
 * the budget is hit — rerun the same command to continue.
 */
import '../../../src/config/env.js'
import fs from 'node:fs'
import { listEligibleTelonexMarkets, type Market } from '../../../src/db/telonexMarkets.js'
import { closeDb } from '../../../src/db/index.js'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const PROTOCOL_FLOOR_MS = 1775088000000 // 2026-04-02, RULES universe floor
const PINNED_TO_MS = 1784762100000 // E-022/E-024 pinned-800 upper bound
const WINDOW_MS = 15 * 60 * 1000 // full market window
const UNIT_SHARES = 10 // RULES-style increment (pre-registered)
const LATENCY_MS = 140 // deployable-bound variant (pre-registered)
const EPS = 1e-9

function fail(msg: string): never {
  console.error(`[fillprobe] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = {
  latest: number
  toMs: number
  maxMarkets: number | null
  checkpoint: string | null
  timeBudgetS: number | null
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    latest: 800,
    toMs: PINNED_TO_MS,
    maxMarkets: null,
    checkpoint: null,
    timeBudgetS: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${flag} requires a value`)
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) fail(`${flag} expects a positive number, got '${v}'`)
      return n
    }
    switch (flag) {
      case '--latest':
        o.latest = next()
        break
      case '--to-ms':
        o.toMs = next()
        break
      case '--max-markets':
        o.maxMarkets = next()
        break
      case '--checkpoint': {
        const v = argv[++i]
        if (v === undefined) fail(`${flag} requires a value`)
        o.checkpoint = v
        break
      }
      case '--time-budget-s':
        o.timeBudgetS = next()
        break
      default:
        fail(`unknown flag '${flag}'`)
    }
  }
  return o
}

type Level = { price: number; size: number }
type Best = { bid: number | null; ask: number | null; bids: Level[] }

function sizeAtPrice(levels: Level[], price: number): number {
  for (const l of levels) if (Math.abs(l.price - price) < EPS) return l.size
  return 0
}

/**
 * One quoter automaton: (fill model, latency) pair for a single side.
 * State machine per event: activate pending quote -> check fills against the
 * standing quote -> re-arm / reprice.
 */
class Quoter {
  fills = 0
  shares = 0
  private quote: number | null = null
  private remaining = 0
  private rearmAt: number | null = null // 140ms-variant pending (re)quote time

  constructor(
    private readonly optimistic: boolean,
    private readonly latencyMs: number,
  ) {}

  onEvent(ts: number, prev: Best, cur: Best): void {
    // 0. Initial placement: the quoter starts quoting at the first in-window
    //    event (no pre-existing trigger, so no latency to model here).
    if (this.quote === null && this.rearmAt === null) this.rearmAt = ts
    // 1. Pending activation (140ms variant) — price at the bestBid prevailing now.
    if (this.rearmAt !== null && ts >= this.rearmAt && prev.bid !== null) {
      this.quote = prev.bid
      this.remaining = UNIT_SHARES
      this.rearmAt = null
    }
    // 0ms variant: instantly (re)arm at the standing bestBid.
    if (this.latencyMs === 0 && prev.bid !== null && this.quote !== prev.bid) {
      this.quote = prev.bid
      this.remaining = UNIT_SHARES
    }
    if (this.quote === null) return

    // 2a. O-only: displayed size at our level decreased while it was bestBid.
    if (
      this.optimistic &&
      this.remaining > 0 &&
      prev.bid !== null &&
      Math.abs(prev.bid - this.quote) < EPS
    ) {
      const before = sizeAtPrice(prev.bids, this.quote)
      const after = sizeAtPrice(cur.bids, this.quote)
      if (after < before - EPS) {
        const c = Math.min(before - after, this.remaining)
        this.shares += c
        this.remaining -= c
        this.fills += 1
      }
    }
    // 2b. W rule (both models): post-event bestAsk strictly below our bid.
    if (this.remaining > 0 && cur.ask !== null && cur.ask < this.quote - EPS) {
      this.shares += this.remaining
      this.remaining = 0
      this.fills += 1
    }

    // 3. Consumed -> re-arm.
    if (this.remaining <= EPS) {
      if (this.latencyMs === 0) {
        this.quote = cur.bid
        this.remaining = this.quote !== null ? UNIT_SHARES : 0
      } else {
        this.quote = null
        this.remaining = 0
        this.rearmAt = ts + this.latencyMs
      }
      return
    }
    // 4. bestBid moved -> reprice (a repriced order is a new order).
    if (cur.bid !== null && Math.abs(cur.bid - this.quote) >= EPS) {
      if (this.latencyMs === 0) {
        this.quote = cur.bid
        this.remaining = UNIT_SHARES
      } else if (this.rearmAt === null) {
        this.rearmAt = ts + this.latencyMs
      }
    }
  }
}

const VARIANTS = [
  { key: 'w0', optimistic: false, latencyMs: 0 },
  { key: 'w140', optimistic: false, latencyMs: LATENCY_MS },
  { key: 'o0', optimistic: true, latencyMs: 0 },
  { key: 'o140', optimistic: true, latencyMs: LATENCY_MS },
] as const
type VariantKey = (typeof VARIANTS)[number]['key']

type MarketResult = {
  slug: string
  epochMs: number
  events: number
  decEventsAtBb: number
  decVolumeAtBb: number
  variants: Record<VariantKey, { fills: number; shares: number }>
}

function slugEpochMs(slug: string): number {
  const epoch = Number(slug.split('-').pop())
  if (!Number.isFinite(epoch) || epoch <= 0) fail(`cannot parse epoch from slug '${slug}'`)
  return epoch * 1000
}

async function scanMarket(m: Market): Promise<MarketResult> {
  const assets = [m.assetId0!, m.assetId1!]
  const w0 = slugEpochMs(m.slug)
  const w1 = w0 + WINDOW_MS

  const prev: Best[] = assets.map(() => ({ bid: null, ask: null, bids: [] }))
  // quoters[side][variant]
  const quoters = assets.map(() =>
    VARIANTS.map((v) => new Quoter(v.optimistic, v.latencyMs)),
  )
  let lastTs = 0
  let done = false
  let events = 0
  let decEvents = 0
  let decVolume = 0

  await replayTelonexDeltaParquetForMarket({
    filePath: m.dataset!,
    shouldStop: () => done,
    onSnapshot: (snapshot) => {
      const ts = Math.max(lastTs, snapshot.timestamp)
      lastTs = ts
      if (ts >= w1) {
        done = true
        return
      }
      const inWindow = ts >= w0
      if (inWindow) events += 1

      for (let side = 0; side < assets.length; side++) {
        const s = snapshot.byAssetId[assets[side]!]
        const cur: Best = {
          bid: s?.bestBid ?? null,
          ask: s?.bestAsk ?? null,
          bids: s?.bids ?? [],
        }
        if (inWindow) {
          const p = prev[side]!
          // raw top-of-book maker-flow ceiling (cancels included, by design)
          if (p.bid !== null) {
            const before = sizeAtPrice(p.bids, p.bid)
            const after = sizeAtPrice(cur.bids, p.bid)
            if (after < before - EPS) {
              decEvents += 1
              decVolume += before - after
            }
          }
          for (const q of quoters[side]!) q.onEvent(ts, p, cur)
        }
        prev[side] = cur
      }
    },
  })

  const variants = Object.fromEntries(
    VARIANTS.map((v, vi) => [
      v.key,
      {
        fills: quoters[0]![vi]!.fills + quoters[1]![vi]!.fills,
        shares:
          Math.round((quoters[0]![vi]!.shares + quoters[1]![vi]!.shares) * 100) / 100,
      },
    ]),
  ) as MarketResult['variants']

  return {
    slug: m.slug,
    epochMs: w0,
    events,
    decEventsAtBb: decEvents,
    decVolumeAtBb: Math.round(decVolume * 100) / 100,
    variants,
  }
}

// ---------- analysis ----------

const r2 = (x: number) => Math.round(x * 100) / 100
const r4 = (x: number) => Math.round(x * 1e4) / 1e4
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / (v.length || 1)
const pct = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
}

function summarize(results: MarketResult[]) {
  const perVariant: Record<string, unknown> = {}
  for (const v of VARIANTS) {
    const shares = results.map((r) => r.variants[v.key].shares)
    const fills = results.map((r) => r.variants[v.key].fills)
    perVariant[v.key] = {
      sharesPerMarket: r2(mean(shares)),
      fillsPerMarket: r2(mean(fills)),
      totalShares: r2(shares.reduce((s, x) => s + x, 0)),
      sharesP10: r2(pct(shares, 0.1)),
      sharesP50: r2(pct(shares, 0.5)),
      sharesP90: r2(pct(shares, 0.9)),
    }
  }
  const sum = (k: VariantKey) => results.reduce((s, r) => s + r.variants[k].shares, 0)
  const w0 = sum('w0')
  const w140 = sum('w140')
  const o0 = sum('o0')
  const o140 = sum('o140')
  const ratio0 = w0 > 0 ? o0 / w0 : null
  const ratio140 = w140 > 0 ? o140 / w140 : null

  const byDay = new Map<string, MarketResult[]>()
  for (const r of results) {
    const day = new Date(r.epochMs).toISOString().slice(0, 10)
    byDay.set(day, [...(byDay.get(day) ?? []), r])
  }
  const perDay = Object.fromEntries(
    [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, rs]) => {
        const dw0 = rs.reduce((s, r) => s + r.variants.w0.shares, 0)
        const do0 = rs.reduce((s, r) => s + r.variants.o0.shares, 0)
        return [
          day,
          {
            markets: rs.length,
            w0SharesPerMkt: r2(dw0 / rs.length),
            o0SharesPerMkt: r2(do0 / rs.length),
            oOverW0: dw0 > 0 ? r4(do0 / dw0) : null,
            decVolumePerMkt: r2(mean(rs.map((r) => r.decVolumeAtBb))),
          },
        ]
      }),
  )

  const decVol = results.map((r) => r.decVolumeAtBb)
  const decEv = results.map((r) => r.decEventsAtBb)

  let verdict: string
  if (ratio0 === null) verdict = 'undefined (zero W shares)'
  else if (ratio0 <= 2) verdict = 'FILL MODEL NOT BINDING (O <= 2x W): fill-limited is a market fact'
  else if (ratio0 >= 3)
    verdict = 'FILL MODEL MATERIALLY BINDING (O >= 3x W): queue-aware fill model required before HF strategy code'
  else verdict = 'NO VERDICT (2x < O/W < 3x): decide follow-up from distribution shape'

  return {
    markets: results.length,
    eventsPerMarket: r2(mean(results.map((r) => r.events))),
    perVariant,
    ratios: { oOverW_0ms_shares: ratio0 === null ? null : r4(ratio0), oOverW_140ms_shares: ratio140 === null ? null : r4(ratio140) },
    decreaseAtBestBid: {
      eventsPerMarket: r2(mean(decEv)),
      volumePerMarket: r2(mean(decVol)),
      volumeP10: r2(pct(decVol, 0.1)),
      volumeP50: r2(pct(decVol, 0.5)),
      volumeP90: r2(pct(decVol, 0.9)),
    },
    byDay: perDay,
    verdict,
  }
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const rows = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local',
    fromMs: PROTOCOL_FLOOR_MS,
    toMs: opts.toMs,
    limit: opts.latest,
    latest: true,
  })
  const usable = rows.filter(
    (m) => m.dataset && fs.existsSync(m.dataset) && m.assetId0 && m.assetId1,
  )
  const skipped = rows.length - usable.length
  const target = opts.maxMarkets ? usable.slice(0, opts.maxMarkets) : usable
  console.error(
    `[fillprobe] universe latest=${opts.latest} toMs=${opts.toMs} rows=${rows.length} usable=${usable.length} skipped=${skipped} scanning=${target.length}`,
  )

  const ckptMeta = {
    toMs: opts.toMs,
    latest: opts.latest,
    windowMs: WINDOW_MS,
    unit: UNIT_SHARES,
    latencyMs: LATENCY_MS,
  }
  const cached = new Map<string, MarketResult>()
  if (opts.checkpoint && fs.existsSync(opts.checkpoint)) {
    for (const line of fs.readFileSync(opts.checkpoint, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue // truncated tail line — market will be re-scanned
      }
      const rec = obj as { __meta?: typeof ckptMeta } & MarketResult
      if (rec.__meta) {
        if (JSON.stringify(rec.__meta) !== JSON.stringify(ckptMeta))
          fail(
            `checkpoint ${opts.checkpoint} was written with different params ` +
              `(${JSON.stringify(rec.__meta)} vs ${JSON.stringify(ckptMeta)}) — delete it or match flags`,
          )
        continue
      }
      if (rec.slug) cached.set(rec.slug, rec)
    }
    console.error(`[fillprobe] checkpoint: ${cached.size} markets already scanned`)
  } else if (opts.checkpoint) {
    fs.appendFileSync(opts.checkpoint, JSON.stringify({ __meta: ckptMeta }) + '\n')
  }

  const t0 = Date.now()
  const results: MarketResult[] = []
  let scannedNow = 0
  let timedOut = false
  for (let i = 0; i < target.length; i++) {
    const mkt = target[i]!
    const hit = cached.get(mkt.slug)
    if (hit) {
      results.push(hit)
      continue
    }
    if (opts.timeBudgetS !== null && (Date.now() - t0) / 1000 > opts.timeBudgetS) {
      timedOut = true
      break
    }
    const r = await scanMarket(mkt)
    results.push(r)
    scannedNow += 1
    if (opts.checkpoint) fs.appendFileSync(opts.checkpoint, JSON.stringify(r) + '\n')
    if (scannedNow % 25 === 0 || i + 1 === target.length) {
      const dt = (Date.now() - t0) / 1000
      console.error(
        `[fillprobe] ${results.length}/${target.length} markets (${scannedNow} this pass), ${dt.toFixed(0)}s elapsed (${(scannedNow / dt).toFixed(2)} mkts/s)`,
      )
    }
  }

  if (timedOut) {
    console.error(
      `[fillprobe] time budget ${opts.timeBudgetS}s hit: ${results.length}/${target.length} done — rerun with the same --checkpoint to continue`,
    )
    console.log(JSON.stringify({ partial: true, done: results.length, total: target.length }))
    await closeDb()
    return
  }

  const result = {
    scannedAt: new Date().toISOString(),
    universe: {
      latest: opts.latest,
      toMs: opts.toMs,
      scanned: results.length,
      skipped,
      firstSlug: target[0]?.slug ?? null,
      lastSlug: target[target.length - 1]?.slug ?? null,
    },
    windowMs: WINDOW_MS,
    unitShares: UNIT_SHARES,
    latencyMs: LATENCY_MS,
    analysis: summarize(results),
  }
  console.log(JSON.stringify(result, null, 2))
  await closeDb()
}

main().catch((err) => {
  console.error('[fillprobe] FATAL', err)
  process.exit(1)
})
