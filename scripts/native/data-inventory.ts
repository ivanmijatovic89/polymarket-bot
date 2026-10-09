/**
 * Read-only inventory of the local datasets on this host for the native
 * parity and benchmark work (native/spec 01 §6 M1/M2 data access, 60 §4.2
 * MS-0…MS-5, 14 §4.1/§5.1 F-19, 11 §5.3 fee eras, D38).
 *
 * - MySQL is read ONLY through src/db/telonexMarkets.ts (eligibility single
 *   source of truth); no inline SQL, no writes.
 * - Local files are only stat()ed / listed, never opened for writing.
 * - The only file written is the Markdown report given by --out (stdout when
 *   omitted).
 *
 * Usage: npx tsx scripts/native/data-inventory.ts [--out <report.md>]
 */
import '../../src/config/env.js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDb } from '../../src/db/index.js'
import {
  countEligibleTelonexMarkets,
  getMarketBySlug,
  listEligibleTelonexMarkets,
  type EligibleMarketsQuery,
  type Market,
} from '../../src/db/telonexMarkets.js'
import {
  TELONEX_DATASET_ELIGIBLE_FROM_MS,
  telonexDatasetMaxStartMs,
} from '../../src/config/telonex.js'
import {
  aggTradesDayDir,
  isoDateFromAggTradesFilename,
  utcDateRange,
  utcDatesCovering,
} from '../../src/binance/paths.js'
import {
  CRYPTO_PRICES_COVERAGE_FROM_MS,
  cryptoPricesDayDir,
  isoDateFromCryptoPricesFilename,
} from '../../src/telonex/cryptoPrices/paths.js'
import {
  binanceFeedLookbackMs,
  rtdsChainlinkLookbackMs,
} from '../../src/backtest/feeds/wireBacktestExternalFeeds.js'
import type { ExternalFeedsRequestConfig } from '../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SYMBOL = 'btc'
const PAIR = 'BTCUSDT'
const CL_ASSET = 'btcusd'
const CONVERTER = 'delta-typed' as const
const HEAVY_1 = 'btc-updown-15m-1780925400'
const TIMEFRAMES: Array<{ tf: string; ms: number }> = [
  { tf: '15m', ms: 15 * 60_000 },
  { tf: '5m', ms: 5 * 60_000 },
]
/** 11 §5.3 dated fallback fee table, keyed by market start. */
const FEE_ERAS: Array<{ id: string; untilMs: number; label: string }> = [
  { id: 'F0', untilMs: 1767571200000, label: '< 2026-01-05' },
  { id: 'F1', untilMs: 1774828800000, label: '2026-01-05 → 2026-03-30' },
  { id: 'F2', untilMs: 1778198400000, label: '2026-03-30 → 2026-05-08' },
  { id: 'F3', untilMs: Number.POSITIVE_INFINITY, label: '≥ 2026-05-08' },
]
/** S15-CL feed request (60 MS-0): Binance + Chainlink + price-to-beat. */
const CL_FEEDS: ExternalFeedsRequestConfig = {
  binanceWsSpotPrice: { symbol: 'btcusdt' },
  rtdsCryptoPrices: { chainlinkSymbols: ['btc/usd'] },
  polymarketPriceToBeat: { enabled: true },
}
const NO_LIMIT = 10_000_000

function parseArgs(argv: string[]): { out: string | null } {
  let out: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') {
      const v = argv[++i]
      if (!v) throw new Error('--out requires a path')
      out = v
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return { out }
}

const iso = (ms: number): string => new Date(ms).toISOString()
const month = (ms: number): string => iso(ms).slice(0, 7)
const feeEra = (ms: number): string => FEE_ERAS.find((e) => ms < e.untilMs)!.id

function resolveLocal(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p)
}

type DaySet = { dates: Set<string>; sorted: string[]; bytes: number; otherFiles: string[] }

function listDays(dir: string, parse: (name: string) => string | null): DaySet {
  const dates = new Set<string>()
  const otherFiles: string[] = []
  let bytes = 0
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const d = parse(name)
      if (d) {
        dates.add(d)
        bytes += fs.statSync(path.join(dir, name)).size
      } else otherFiles.push(name)
    }
  }
  return { dates, sorted: [...dates].sort(), bytes, otherFiles }
}

/** Missing dates between the first and last present date, compressed to ranges. */
function gaps(days: DaySet): string[] {
  const first = days.sorted[0]
  const last = days.sorted[days.sorted.length - 1]
  if (!first || !last) return []
  const out: string[] = []
  let runStart: string | null = null
  let prev: string | null = null
  for (const d of utcDateRange(first, last)) {
    if (!days.dates.has(d)) {
      if (runStart === null) runStart = d
      prev = d
    } else if (runStart !== null) {
      out.push(runStart === prev ? runStart : `${runStart} → ${prev}`)
      runStart = null
    }
  }
  return out
}

type Row = {
  m: Market
  local: boolean
  sizeMismatch: boolean
  binanceOk: boolean
  chainlinkOk: boolean // false for pre-coverage markets (F-19)
  ptb: boolean
}

function evaluate(m: Market, tfMs: number, bn: DaySet, cl: DaySet): Row {
  let local = false
  let sizeMismatch = false
  if (m.dataset) {
    try {
      const st = fs.statSync(resolveLocal(m.dataset))
      local = st.isFile()
      sizeMismatch =
        local && m.conversionSizeBytes !== null && st.size !== Number(m.conversionSizeBytes)
    } catch {
      local = false
    }
  }
  const start = m.marketStartMs
  const end = start + tfMs
  const binanceOk = utcDatesCovering(start - binanceFeedLookbackMs(), end).every((d) =>
    bn.dates.has(d),
  )
  const chainlinkOk =
    start >= CRYPTO_PRICES_COVERAGE_FROM_MS &&
    utcDatesCovering(
      Math.max(start - rtdsChainlinkLookbackMs(), CRYPTO_PRICES_COVERAGE_FROM_MS),
      end,
    ).every((d) => cl.dates.has(d))
  return { m, local, sizeMismatch, binanceOk, chainlinkOk, ptb: m.priceToBeat !== null }
}

const allThree = (r: Row): boolean => r.local && r.binanceOk && r.chainlinkOk && r.ptb

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const g = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = g.get(k)
    if (arr) arr.push(r)
    else g.set(k, [r])
  }
  return new Map([...g.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function table(header: string[], rows: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>): string => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

function countRows(rows: Row[]): Array<number> {
  return [
    rows.length,
    rows.filter((r) => r.local).length,
    rows.filter((r) => !r.local).length,
    rows.filter((r) => r.sizeMismatch).length,
    rows.filter((r) => r.binanceOk).length,
    rows.filter((r) => r.chainlinkOk).length,
    rows.filter((r) => r.ptb).length,
    rows.filter(allThree).length,
  ]
}

const ROW_HEADER = [
  'eligible (DB, local)',
  'file present',
  'file missing',
  'size ≠ DB',
  'Binance days ok',
  'Chainlink days ok',
  'PTB set',
  'all three + PTB',
]

function localFileSlugs(tf: string): string[] {
  const dir = path.join(REPO_ROOT, 'data', 'events', 'telonex', CONVERTER, SYMBOL, tf)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.parquet'))
    .map((n) => n.slice(0, -'.parquet'.length))
}

async function main(): Promise<void> {
  const { out } = parseArgs(process.argv.slice(2))
  const t0 = Date.now()
  const md: string[] = []
  const push = (...s: string[]): void => void md.push(...s)

  const head = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  const maxStartMs = telonexDatasetMaxStartMs()

  const bn = listDays(aggTradesDayDir(PAIR), (n) => isoDateFromAggTradesFilename(n, PAIR))
  const cl = listDays(cryptoPricesDayDir(CL_ASSET), (n) =>
    isoDateFromCryptoPricesFilename(n, CL_ASSET),
  )

  push(
    '# Data inventory — worker-1, 2026-10-09',
    '',
    'Read-only inventory of the local datasets for the native parity and benchmark',
    'work (01 §6 M1 step 1 / M2 step 1, 01 §8.1 H2, 60 §4.2 MS-0…MS-5, 14 §4.1,',
    '§5.1 F-19, 11 §5.3, D38). Generated by `scripts/native/data-inventory.ts`.',
    '',
    `- Command: \`npx tsx scripts/native/data-inventory.ts --out native/reports/data-inventory-20261009-worker-1.md\``,
    `- Host: \`${os.hostname()}\`; generated ${iso(t0)}; checkout HEAD \`${head}\``,
    `- Repo root (local_path anchor, as \`runSingleMarket.ts\`): \`${REPO_ROOT}\``,
    `- data links: ${['events', 'binance', 'telonex']
      .map((d) => {
        const p = path.join(REPO_ROOT, 'data', d)
        try {
          return `\`data/${d}\` → \`${fs.readlinkSync(p)}\``
        } catch {
          return `\`data/${d}\` (not a symlink)`
        }
      })
      .join(', ')}`,
    `- Eligibility: \`src/db/telonexMarkets.ts\` (\`listEligibleTelonexMarkets\` / \`countEligibleTelonexMarkets\`), converter \`${CONVERTER}\`, readFrom \`local\`, symbol \`${SYMBOL}\`, resolved only; floor TELONEX_DATASET_ELIGIBLE_FROM = ${iso(TELONEX_DATASET_ELIGIBLE_FROM_MS)}; publication-lag ceiling (market_start_ms ≤) ${iso(maxStartMs)}`,
    `- Feed day sets as the backtest computes them: Binance \`utcDatesCovering(start − ${binanceFeedLookbackMs()} ms, end)\`; Chainlink \`utcDatesCovering(max(start − ${rtdsChainlinkLookbackMs()} ms, 2026-04-02), end)\`, pre-coverage (F-19) counts as not ok`,
    '- "all three + PTB" = telonex-delta file present AND every Binance day AND every Chainlink day present locally AND `price_to_beat` set (the S15-CL input requirement of 60 MS-0)',
    '',
  )

  // --- Feed day files -------------------------------------------------------
  const daySection = (title: string, dir: string, d: DaySet): void => {
    const g = gaps(d)
    push(
      `### ${title}`,
      '',
      `- Directory: \`${path.relative(REPO_ROOT, dir)}\``,
      `- Day files: ${d.sorted.length}, ${(d.bytes / 1e9).toFixed(2)} GB; range ${d.sorted[0] ?? '—'} → ${d.sorted[d.sorted.length - 1] ?? '—'}`,
      `- Gaps inside the range: ${g.length === 0 ? 'none' : g.join(', ')}`,
      `- Other entries in the directory: ${d.otherFiles.length === 0 ? 'none' : d.otherFiles.join(', ')}`,
      '',
    )
  }
  push('## 1. Feed day files', '')
  const bnRoot = path.dirname(aggTradesDayDir(PAIR))
  const pairs = fs.existsSync(bnRoot) ? fs.readdirSync(bnRoot) : []
  push(`Binance aggTrades pair directories present: ${pairs.join(', ') || 'none'}.`, '')
  daySection(`Binance aggTrades ${PAIR}`, aggTradesDayDir(PAIR), bn)
  const clRoot = path.dirname(cryptoPricesDayDir(CL_ASSET))
  const assets = fs.existsSync(clRoot) ? fs.readdirSync(clRoot) : []
  push(`Chainlink crypto_prices asset directories present: ${assets.join(', ') || 'none'}.`, '')
  daySection(`Chainlink crypto_prices ${CL_ASSET}`, cryptoPricesDayDir(CL_ASSET), cl)

  // --- Telonex-delta markets ---------------------------------------------
  const rowsByTf = new Map<string, Row[]>()
  push('## 2. Eligible telonex-delta markets vs local files', '')
  for (const { tf, ms } of TIMEFRAMES) {
    const q: EligibleMarketsQuery = {
      symbol: SYMBOL,
      timeframe: tf,
      converter: CONVERTER,
      readFrom: 'local',
      limit: NO_LIMIT,
    }
    const [markets, countLocal, countR2] = await Promise.all([
      listEligibleTelonexMarkets(q),
      countEligibleTelonexMarkets(q),
      countEligibleTelonexMarkets({ ...q, readFrom: 'r2' }),
    ])
    if (markets.length !== countLocal) {
      throw new Error(`list/count disagree for ${tf}: ${markets.length} vs ${countLocal}`)
    }
    const rows = markets.map((m) => evaluate(m, ms, bn, cl))
    rowsByTf.set(tf, rows)
    const eligibleSlugs = new Set(markets.map((m) => m.slug))
    const files = localFileSlugs(tf)
    const orphans = files.filter((s) => !eligibleSlugs.has(s))
    const slugMs = (s: string): number => Number(s.slice(s.lastIndexOf('-') + 1)) * 1000
    const orphansBeforeFloor = orphans.filter((s) => slugMs(s) < TELONEX_DATASET_ELIGIBLE_FROM_MS)
    const orphansAfterCeiling = orphans.filter((s) => slugMs(s) > maxStartMs)
    const orphansOther = orphans.filter(
      (s) => slugMs(s) >= TELONEX_DATASET_ELIGIBLE_FROM_MS && slugMs(s) <= maxStartMs,
    )
    const mismatched = rows.filter((r) => r.sizeMismatch).map((r) => r.m.slug)
    const first = markets[0]
    const last = markets[markets.length - 1]
    push(
      `### BTC ${tf}`,
      '',
      `- Eligible (DB, readFrom local): **${countLocal}**; eligible with readFrom r2 (for reference): ${countR2}`,
      `- Eligible market_start range: ${first ? iso(first.marketStartMs) : '—'} → ${last ? iso(last.marketStartMs) : '—'}`,
      `- Local parquet files under \`data/events/telonex/${CONVERTER}/${SYMBOL}/${tf}\`: ${files.length}; of these not in the eligible set: ${orphans.length} (slug start before the eligibility floor: ${orphansBeforeFloor.length}; after the publication-lag ceiling: ${orphansAfterCeiling.length}; inside the range but not eligible: ${orphansOther.length}${orphansOther.length > 0 ? `, e.g. ${orphansOther.slice(0, 5).join(', ')}` : ''})`,
      `- Local size differs from \`telonex_market_conversions.size_bytes\`: ${mismatched.length === 0 ? 'none' : mismatched.slice(0, 20).join(', ')}`,
      '',
      table(
        ['month', ...ROW_HEADER],
        [...groupBy(rows, (r) => month(r.m.marketStartMs)).entries()].map(([k, rs]) => [
          k,
          ...countRows(rs),
        ]),
      ),
      '',
      table(['total', ...ROW_HEADER], [['all', ...countRows(rows)]]),
      '',
    )
  }

  // --- S15-CL universe ------------------------------------------------------
  const r15 = rowsByTf.get('15m') ?? []
  const postCl = r15.filter((r) => r.m.marketStartMs >= CRYPTO_PRICES_COVERAGE_FROM_MS)
  const clQuery: EligibleMarketsQuery = {
    symbol: SYMBOL,
    timeframe: '15m',
    converter: CONVERTER,
    readFrom: 'local',
    requiredFeeds: CL_FEEDS,
    fromMs: CRYPTO_PRICES_COVERAGE_FROM_MS,
    limit: NO_LIMIT,
  }
  const clEligible = await listEligibleTelonexMarkets(clQuery)
  const clRows = clEligible.map((m) => evaluate(m, 15 * 60_000, bn, cl))
  push(
    '## 3. S15-CL universe (BTC 15m, start ≥ 2026-04-02)',
    '',
    `- Eligible BTC 15m (no feed flags) starting ≥ 2026-04-02: ${postCl.length}; with all three inputs local + PTB: **${postCl.filter(allThree).length}**`,
    `- Eligible with the S15-CL feed request (\`requiredFeeds\` = binanceWsSpotPrice btcusdt, rtdsCryptoPrices btc/usd, polymarketPriceToBeat; DB flags binance_usable, chainlink_usable, price_to_beat): ${clRows.length}; with all three inputs local: **${clRows.filter(allThree).length}**`,
    '',
    table(
      ['month', 'feed-eligible (DB)', 'file present', 'Binance ok', 'Chainlink ok', 'all three'],
      [...groupBy(clRows, (r) => month(r.m.marketStartMs)).entries()].map(([k, rs]) => [
        k,
        rs.length,
        rs.filter((r) => r.local).length,
        rs.filter((r) => r.binanceOk).length,
        rs.filter((r) => r.chainlinkOk).length,
        rs.filter(allThree).length,
      ]),
    ),
    '',
  )

  // --- Fee eras --------------------------------------------------------------
  const r5 = rowsByTf.get('5m') ?? []
  const era15 = groupBy(r15, (r) => feeEra(r.m.marketStartMs))
  const era5 = groupBy(r5, (r) => feeEra(r.m.marketStartMs))
  const eraCl = groupBy(clRows, (r) => feeEra(r.m.marketStartMs))
  push(
    '## 4. Fee eras (11 §5.3, keyed by market start)',
    '',
    table(
      [
        'era',
        'window',
        '15m eligible',
        '15m file present',
        '15m S15-CL all three',
        '5m eligible',
        '5m file present',
      ],
      FEE_ERAS.map((e) => {
        const a = era15.get(e.id) ?? []
        const b = era5.get(e.id) ?? []
        const c = eraCl.get(e.id) ?? []
        return [
          e.id,
          e.label,
          a.length,
          a.filter((r) => r.local).length,
          c.filter(allThree).length,
          b.length,
          b.filter((r) => r.local).length,
        ]
      }),
    ),
    '',
  )

  // --- heavy-1 -------------------------------------------------------------------
  push(`## 5. heavy-1 (\`${HEAVY_1}\`)`, '')
  const heavyEligible = r15.find((r) => r.m.slug === HEAVY_1)
  const heavyAny = await getMarketBySlug(HEAVY_1, { converter: CONVERTER, readFrom: 'local' })
  const heavyCl = clRows.find((r) => r.m.slug === HEAVY_1)
  if (heavyAny) {
    const r = evaluate(heavyAny, 15 * 60_000, bn, cl)
    let size = '—'
    if (r.local && heavyAny.dataset) {
      size = `${fs.statSync(resolveLocal(heavyAny.dataset)).size} bytes`
    }
    push(
      `- Conversion row (delta-typed, local_path set): yes — \`${heavyAny.dataset}\`, market start ${iso(heavyAny.marketStartMs)}, fee era ${feeEra(heavyAny.marketStartMs)}`,
      `- In the eligible BTC 15m set: ${heavyEligible ? 'yes' : 'no'}; in the S15-CL feed-eligible set: ${heavyCl ? 'yes' : 'no'}`,
      `- Local file present: ${r.local ? 'yes' : 'no'} (${size}; DB size ${heavyAny.conversionSizeBytes ?? '—'}${r.sizeMismatch ? ', MISMATCH' : ''})`,
      `- Binance days ok: ${r.binanceOk ? 'yes' : 'no'}; Chainlink days ok: ${r.chainlinkOk ? 'yes' : 'no'}; PTB set: ${r.ptb ? 'yes' : 'no'}`,
      '',
    )
  } else {
    push(
      '- No delta-typed conversion row with a local_path (getMarketBySlug readFrom local returned null).',
      '',
    )
  }

  push(
    `Runtime: ${((Date.now() - t0) / 1000).toFixed(1)} s. Nothing was written except this report.`,
  )
  push('')

  const text = md.join('\n')
  if (out) {
    fs.writeFileSync(path.resolve(process.cwd(), out), text)
    console.log(`[data-inventory] wrote ${out}`)
  } else {
    process.stdout.write(text)
  }
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err)
    await closeDb()
    process.exit(1)
  })
