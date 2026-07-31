/**
 * tradeprobe.ts — E-025 trade-print calibration of the maker fill model.
 * Pre-registered BEFORE this tool existed: memory/experiments/hf-fill-probe.md
 * §E-025 (session 12, commit eb98934). Read-only: local recorded live-WS
 * parquet only (no DB, no fleet).
 *
 * Dataset: data/events/btc/*.parquet — full market-channel recordings
 * (book + price_change + last_trade_price), one file per 15-min window,
 * including `-terminated` partial recordings (coverage reported per market).
 *
 * On the SAME event stream, per side (asset), three quoter models sharing the
 * E-024 automaton (always rest one 10-share bid at bestBid; 0 ms and 140 ms
 * reprice/re-arm variants):
 *   W (worst-queue, the engine's rule): bid at P fills whole when a
 *     post-event bestAsk < P.
 *   O (optimistic front-of-queue): W PLUS any displayed-size decrease at P
 *     while P is pre-event bestBid, captured up to remaining (cancels
 *     over-counted by design — upper bound).
 *   T (trade-confirmed front-of-queue): capture ONLY from last_trade_price
 *     events at our level while the quote rests there, taker side SELL
 *     (maker = bid), up to min(trade size, remaining). No W-rule fills —
 *     T is purely trade-confirmed (per the frozen §E-025 method, "capture =
 *     min(executed trade volume at our level while quote rests there,
 *     remaining)"). Still front-of-queue, i.e. an upper bound on a joiner,
 *     but a far tighter one than O.
 *
 * Raw flows per market (both sides): total trade count/volume; taker-SELL
 * trade volume printing at the pre-event bestBid (bid-side maker flow, the
 * T ceiling); level-decrease events/volume at pre-event bestBid (the O
 * ceiling); cancel share of decreases = 1 − tradeVolAtBb / decVolAtBb.
 *
 * Side-semantics pre-commit (frozen): before trusting side==SELL as
 * taker-sell, run `--verify-side` and check that SELL trades print at the
 * pre-event bestBid (not bestAsk). If ambiguous, fall back to price-based
 * attribution (trade at price <= pre-event mid ⇒ bid-side execution) via
 * `--attribution price` and say so in the result.
 *
 * Frozen interpretation (aggregate shares over the ~36 markets):
 *   T140 <= 2x W140 -> E-024 gap is mostly cancels; current fill model is an
 *                      acceptable bound (downgrade E-024's verdict scope);
 *   T140 >= 3x W140 -> engine materially understates trade-confirmed capture
 *                      -> P-011 escalates (queue-aware model prerequisite for
 *                      ANY maker-capture claim);
 *   between         -> report; carry both bounds.
 *
 * Usage (from repo root):
 *   tsx protocols/pair-fable/tools/tradeprobe.ts --verify-side [--limit N]
 *   tsx protocols/pair-fable/tools/tradeprobe.ts [--dir data/events/btc]
 *     [--limit N] [--attribution side|price] [--parity <fillprobe.jsonl>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { MarketEngine } from '../../../src/market/MarketEngine.js'
import { openParquetReaderWithEpermFallback } from '../../../src/cli/helpers/openParquetReader.js'

const WINDOW_MS = 15 * 60 * 1000
const UNIT_SHARES = 10 // RULES-style increment, as E-024
const LATENCY_MS = 140 // deployable-bound variant, as E-024
const EPS = 1e-9

function fail(msg: string): never {
  console.error(`[tradeprobe] ERROR: ${msg}`)
  process.exit(2)
}

type Opts = {
  dir: string
  limit: number | null
  verifySide: boolean
  attribution: 'side' | 'price'
  parity: string | null
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    dir: 'data/events/btc',
    limit: null,
    verifySide: false,
    attribution: 'side',
    parity: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const nextStr = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${flag} requires a value`)
      return v
    }
    switch (flag) {
      case '--dir':
        o.dir = nextStr()
        break
      case '--limit': {
        const n = Number(nextStr())
        if (!Number.isFinite(n) || n <= 0) fail(`--limit expects a positive number`)
        o.limit = n
        break
      }
      case '--verify-side':
        o.verifySide = true
        break
      case '--attribution': {
        const v = nextStr()
        if (v !== 'side' && v !== 'price') fail(`--attribution expects side|price`)
        o.attribution = v
        break
      }
      case '--parity':
        o.parity = nextStr()
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
 * E-024 quoter automaton extended with a trade-capture path.
 * Exactly one of the three capture rule-sets is active per instance:
 *   wRule only (W), wRule+oCapture (O), tCapture only (T).
 */
class Quoter {
  fills = 0
  shares = 0
  private quote: number | null = null
  private remaining = 0
  private rearmAt: number | null = null

  constructor(
    private readonly wRule: boolean,
    private readonly oCapture: boolean,
    private readonly tCapture: boolean,
    private readonly latencyMs: number,
  ) {}

  /** Book-driven step: activation, O/W fill checks, re-arm, reprice. */
  onEvent(ts: number, prev: Best, cur: Best): void {
    if (this.quote === null && this.rearmAt === null) this.rearmAt = ts
    if (this.rearmAt !== null && ts >= this.rearmAt && prev.bid !== null) {
      this.quote = prev.bid
      this.remaining = UNIT_SHARES
      this.rearmAt = null
    }
    if (this.latencyMs === 0 && prev.bid !== null && this.quote !== prev.bid) {
      this.quote = prev.bid
      this.remaining = UNIT_SHARES
    }
    if (this.quote === null) return

    if (
      this.oCapture &&
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
    if (this.wRule && this.remaining > 0 && cur.ask !== null && cur.ask < this.quote - EPS) {
      this.shares += this.remaining
      this.remaining = 0
      this.fills += 1
    }

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
    if (cur.bid !== null && Math.abs(cur.bid - this.quote) >= EPS) {
      if (this.latencyMs === 0) {
        this.quote = cur.bid
        this.remaining = UNIT_SHARES
      } else if (this.rearmAt === null) {
        this.rearmAt = ts + this.latencyMs
      }
    }
  }

  /**
   * Trade-driven step (T only): `bidSide` is true when the trade is
   * attributed to bid-side (maker = bid) execution.
   */
  onTrade(ts: number, price: number, size: number, bidSide: boolean): void {
    if (!this.tCapture || !bidSide) return
    if (this.quote === null || this.remaining <= 0) return
    if (Math.abs(price - this.quote) >= EPS) return
    const c = Math.min(size, this.remaining)
    this.shares += c
    this.remaining -= c
    this.fills += 1
    if (this.remaining <= EPS) {
      if (this.latencyMs === 0) {
        // Re-arm at the standing quote level (book state unchanged by a
        // trade print; the next book event reprices if bestBid moved).
        this.remaining = UNIT_SHARES
      } else {
        this.quote = null
        this.remaining = 0
        this.rearmAt = ts + this.latencyMs
      }
    }
  }
}

const VARIANTS = [
  { key: 'w0', w: true, o: false, t: false, latencyMs: 0 },
  { key: 'w140', w: true, o: false, t: false, latencyMs: LATENCY_MS },
  { key: 'o0', w: true, o: true, t: false, latencyMs: 0 },
  { key: 'o140', w: true, o: true, t: false, latencyMs: LATENCY_MS },
  { key: 't0', w: false, o: false, t: true, latencyMs: 0 },
  { key: 't140', w: false, o: false, t: true, latencyMs: LATENCY_MS },
] as const
type VariantKey = (typeof VARIANTS)[number]['key']

type MarketResult = {
  slug: string
  epochMs: number
  terminated: boolean
  events: number
  coverageS: number // in-window seconds from window start to last seen event
  trades: number
  tradeVolume: number
  tradesSellAtBb: number
  tradeVolSellAtBb: number
  decEventsAtBb: number
  decVolumeAtBb: number
  variants: Record<VariantKey, { fills: number; shares: number }>
}

type SideStats = {
  atBid: number
  atAsk: number
  both: number // locked/crossed book: bestBid == bestAsk == price
  inside: number
  outside: number
  noBook: number
  volAtBid: number
  volAtAsk: number
}

function slugFromFile(f: string): { slug: string; epochMs: number; terminated: boolean } {
  const base = path.basename(f, '.parquet')
  const terminated = base.endsWith('-terminated')
  const slug = terminated ? base.slice(0, -'-terminated'.length) : base
  const epoch = Number(slug.split('-').pop())
  if (!Number.isFinite(epoch) || epoch <= 0) fail(`cannot parse epoch from file '${f}'`)
  return { slug, epochMs: epoch * 1000, terminated }
}

type ReplayRow = {
  event_type?: unknown
  raw_json?: unknown
}

async function scanMarket(
  filePath: string,
  attribution: 'side' | 'price',
  collectSideStats: { BUY: SideStats; SELL: SideStats } | null,
): Promise<MarketResult> {
  const { slug, epochMs, terminated } = slugFromFile(filePath)
  const w0 = epochMs
  const w1 = epochMs + WINDOW_MS

  const eng = new MarketEngine()
  const assets: string[] = []
  const prev = new Map<string, Best>()
  const quoters = new Map<string, Quoter[]>()
  let activeMarket: string | undefined
  let lastTs = 0
  let events = 0
  let lastInWindowTs = 0
  let trades = 0
  let tradeVolume = 0
  let tradesSellAtBb = 0
  let tradeVolSellAtBb = 0
  let decEvents = 0
  let decVolume = 0

  const reader = await openParquetReaderWithEpermFallback(filePath)
  try {
    const cursor = reader.getCursor()
    let row: ReplayRow | null
    while ((row = (await cursor.next()) as ReplayRow | null)) {
      const et = typeof row.event_type === 'string' ? row.event_type : undefined
      if (et !== 'book' && et !== 'price_change' && et !== 'last_trade_price') continue
      const rawJson =
        typeof row.raw_json === 'string' ? row.raw_json : JSON.stringify(row.raw_json ?? null)
      const msg = await eng.handleRaw({
        rawJson,
        source: { kind: 'parquet', filePath, ingestSeq: 0n },
      })
      if (!msg) continue
      if (!activeMarket) activeMarket = msg.market
      if (msg.market !== activeMarket) continue

      const msgTs = Number((msg as { timestamp?: string }).timestamp)
      const ts = Math.max(lastTs, Number.isFinite(msgTs) ? msgTs : lastTs)
      lastTs = ts
      if (ts >= w1) break
      const inWindow = ts >= w0
      if (inWindow) {
        events += 1
        lastInWindowTs = ts
      }

      if (msg.event_type === 'last_trade_price') {
        const price = Number(msg.price)
        const size = Number(msg.size)
        if (!Number.isFinite(price) || !Number.isFinite(size)) continue
        const p = prev.get(msg.asset_id)
        if (!inWindow) continue
        trades += 1
        tradeVolume += size

        const atBid = p?.bid !== null && p?.bid !== undefined && Math.abs(price - p.bid) < EPS
        const atAsk = p?.ask !== null && p?.ask !== undefined && Math.abs(price - p.ask) < EPS
        if (collectSideStats && (msg.side === 'BUY' || msg.side === 'SELL')) {
          const s = collectSideStats[msg.side]
          if (!p || (p.bid === null && p.ask === null)) s.noBook += 1
          else if (atBid && atAsk) s.both += 1
          else if (atBid) {
            s.atBid += 1
            s.volAtBid += size
          } else if (atAsk) {
            s.atAsk += 1
            s.volAtAsk += size
          } else {
            const mid =
              p.bid !== null && p.ask !== null ? (p.bid + p.ask) / 2 : (p.bid ?? p.ask ?? null)
            if (mid !== null && price > (p.bid ?? -1) + EPS && price < (p.ask ?? 2) - EPS)
              s.inside += 1
            else s.outside += 1
          }
        }

        // Bid-side (maker = bid) attribution for T and raw flows.
        let bidSide: boolean
        if (attribution === 'side') {
          bidSide = msg.side === 'SELL'
        } else {
          const mid = p && p.bid !== null && p.ask !== null ? (p.bid + p.ask) / 2 : null
          bidSide = mid !== null && price <= mid + EPS
        }
        if (bidSide && atBid) {
          tradesSellAtBb += 1
          tradeVolSellAtBb += size
        }
        const qs = quoters.get(msg.asset_id)
        if (qs) for (const q of qs) q.onTrade(ts, price, size, bidSide)
        continue
      }

      // book / price_change: update per-asset Best state and step quoters.
      const snapshot = eng.snapshot()
      for (const assetId of Object.keys(snapshot.byAssetId)) {
        if (!prev.has(assetId)) {
          if (assets.length >= 2) continue // ignore stray assets beyond the pair
          assets.push(assetId)
          prev.set(assetId, { bid: null, ask: null, bids: [] })
          quoters.set(
            assetId,
            VARIANTS.map((v) => new Quoter(v.w, v.o, v.t, v.latencyMs)),
          )
        }
        const s = snapshot.byAssetId[assetId]!
        const cur: Best = { bid: s.bestBid, ask: s.bestAsk, bids: s.bids }
        const p = prev.get(assetId)!
        if (inWindow) {
          if (p.bid !== null) {
            const before = sizeAtPrice(p.bids, p.bid)
            const after = sizeAtPrice(cur.bids, p.bid)
            if (after < before - EPS) {
              decEvents += 1
              decVolume += before - after
            }
          }
          for (const q of quoters.get(assetId)!) q.onEvent(ts, p, cur)
        }
        prev.set(assetId, cur)
      }
    }
  } finally {
    await reader.close().catch(() => undefined)
  }

  const variants = Object.fromEntries(
    VARIANTS.map((v, vi) => {
      let fills = 0
      let shares = 0
      for (const assetId of assets) {
        const q = quoters.get(assetId)![vi]!
        fills += q.fills
        shares += q.shares
      }
      return [v.key, { fills, shares: Math.round(shares * 100) / 100 }]
    }),
  ) as MarketResult['variants']

  return {
    slug,
    epochMs,
    terminated,
    events,
    coverageS: Math.round((lastInWindowTs > 0 ? lastInWindowTs - w0 : 0) / 100) / 10,
    trades,
    tradeVolume: Math.round(tradeVolume * 100) / 100,
    tradesSellAtBb,
    tradeVolSellAtBb: Math.round(tradeVolSellAtBb * 100) / 100,
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

function summarize(results: MarketResult[], attribution: 'side' | 'price') {
  const perVariant: Record<string, unknown> = {}
  for (const v of VARIANTS) {
    const shares = results.map((r) => r.variants[v.key].shares)
    perVariant[v.key] = {
      sharesPerMarket: r2(mean(shares)),
      fillsPerMarket: r2(mean(results.map((r) => r.variants[v.key].fills))),
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
  const t0 = sum('t0')
  const t140 = sum('t140')
  const ratio = (a: number, b: number) => (b > 0 ? r4(a / b) : null)

  const cancelShares = results
    .filter((r) => r.decVolumeAtBb > 0)
    .map((r) => 1 - r.tradeVolSellAtBb / r.decVolumeAtBb)
  const totalDec = results.reduce((s, r) => s + r.decVolumeAtBb, 0)
  const totalTradeAtBb = results.reduce((s, r) => s + r.tradeVolSellAtBb, 0)

  const tOverW140 = w140 > 0 ? t140 / w140 : null
  let interpretation: string
  if (tOverW140 === null) interpretation = 'undefined (zero W140 shares)'
  else if (tOverW140 <= 2)
    interpretation =
      'T140 <= 2x W140: trade-confirmed ceiling near worst-queue — E-024 gap is mostly cancels; current fill model an acceptable bound (downgrade E-024 scope)'
  else if (tOverW140 >= 3)
    interpretation =
      'T140 >= 3x W140: engine materially understates trade-confirmed capture — P-011 escalates (queue-aware fill model prerequisite for ANY maker-capture claim)'
  else interpretation = 'between 2x and 3x: report; carry both bounds in maker reasoning'

  return {
    markets: results.length,
    attribution,
    eventsPerMarket: r2(mean(results.map((r) => r.events))),
    tradesPerMarket: r2(mean(results.map((r) => r.trades))),
    tradeVolumePerMarket: r2(mean(results.map((r) => r.tradeVolume))),
    perVariant,
    ratios: {
      tOverW_0ms: ratio(t0, w0),
      tOverW_140ms: ratio(t140, w140),
      oOverT_0ms: ratio(o0, t0),
      oOverT_140ms: ratio(o140, t140),
      oOverW_0ms: ratio(o0, w0),
      oOverW_140ms: ratio(o140, w140),
    },
    bidSideMakerFlow: {
      tradesAtBbPerMarket: r2(mean(results.map((r) => r.tradesSellAtBb))),
      tradeVolAtBbPerMarket: r2(mean(results.map((r) => r.tradeVolSellAtBb))),
      decEventsAtBbPerMarket: r2(mean(results.map((r) => r.decEventsAtBb))),
      decVolumeAtBbPerMarket: r2(mean(results.map((r) => r.decVolumeAtBb))),
      cancelShareOfDecreaseVolume: totalDec > 0 ? r4(1 - totalTradeAtBb / totalDec) : null,
      cancelShareP10: r4(pct(cancelShares, 0.1)),
      cancelShareP50: r4(pct(cancelShares, 0.5)),
      cancelShareP90: r4(pct(cancelShares, 0.9)),
    },
    interpretation,
  }
}

function parityNote(results: MarketResult[], parityFile: string) {
  const byslug = new Map<string, { w0: number; o0: number }>()
  for (const line of fs.readFileSync(parityFile, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let obj: { slug?: string; variants?: { w0?: { shares: number }; o0?: { shares: number } } }
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.slug && obj.variants?.w0 && obj.variants?.o0)
      byslug.set(obj.slug, { w0: obj.variants.w0.shares, o0: obj.variants.o0.shares })
  }
  const common = results
    .filter((r) => byslug.has(r.slug))
    .map((r) => ({
      slug: r.slug,
      recorded: { w0: r.variants.w0.shares, o0: r.variants.o0.shares },
      telonex: byslug.get(r.slug)!,
    }))
  return {
    commonSlugs: common.length,
    perSlug: common,
    meanRecordedOverTelonexO0:
      common.length > 0
        ? r4(
            mean(
              common
                .filter((c) => c.telonex.o0 > 0)
                .map((c) => c.recorded.o0 / c.telonex.o0),
            ),
          )
        : null,
  }
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const files = fs
    .readdirSync(opts.dir)
    .filter((f) => f.endsWith('.parquet'))
    .sort()
    .map((f) => path.join(opts.dir, f))
  const target = opts.limit ? files.slice(0, opts.limit) : files
  if (target.length === 0) fail(`no parquet files in ${opts.dir}`)
  console.error(
    `[tradeprobe] dir=${opts.dir} files=${files.length} scanning=${target.length} mode=${opts.verifySide ? 'verify-side' : 'full'} attribution=${opts.attribution}`,
  )

  const sideStats: { BUY: SideStats; SELL: SideStats } | null = opts.verifySide
    ? {
        BUY: { atBid: 0, atAsk: 0, both: 0, inside: 0, outside: 0, noBook: 0, volAtBid: 0, volAtAsk: 0 },
        SELL: { atBid: 0, atAsk: 0, both: 0, inside: 0, outside: 0, noBook: 0, volAtBid: 0, volAtAsk: 0 },
      }
    : null

  const t0 = Date.now()
  const results: MarketResult[] = []
  for (let i = 0; i < target.length; i++) {
    results.push(await scanMarket(target[i]!, opts.attribution, sideStats))
    if ((i + 1) % 10 === 0 || i + 1 === target.length)
      console.error(
        `[tradeprobe] ${i + 1}/${target.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      )
  }

  if (opts.verifySide) {
    console.log(
      JSON.stringify(
        { scannedAt: new Date().toISOString(), files: target.length, sideStats },
        null,
        2,
      ),
    )
    return
  }

  const result = {
    scannedAt: new Date().toISOString(),
    dir: opts.dir,
    windowMs: WINDOW_MS,
    unitShares: UNIT_SHARES,
    latencyMs: LATENCY_MS,
    analysis: summarize(results, opts.attribution),
    parity: opts.parity ? parityNote(results, opts.parity) : null,
    perMarket: results,
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error('[tradeprobe] FATAL', err)
  process.exit(1)
})
