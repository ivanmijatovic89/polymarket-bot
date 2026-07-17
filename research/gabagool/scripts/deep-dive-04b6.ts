/**
 * deep-dive-04b6.ts — per-market microstructure of 0x04b6d7e9's btc-15m
 * sleeve from a full /activity pull window (OPEN-QUESTIONS #1).
 *
 * Per btc-updown-15m market fully inside the pull window (>=1h margins,
 * per the boundary-truncation pitfall): leg shares/notional/avg px per
 * side, pairs, pairRate, excess side, ladder breadth (distinct price
 * levels per side), inter-fill gaps, and gross PnL vs resolution
 * (winner from telonex DB result_id via the sanctioned module).
 *
 * Answers: is pairRate ~0.78 a CHOICE (excess leg picked well) or a
 * CONSTRAINT (cheap-side fills arrive adversely)?
 *
 * Usage: npx tsx research/gabagool/scripts/deep-dive-04b6.ts \
 *   --activity research/gabagool/data/activity-04b6d7e9-jun12-14.jsonl
 */
import { readFileSync } from 'node:fs'
import { listEligibleTelonexMarkets } from '../../../src/db/telonexMarkets.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const activityPath = argOf('activity')!

type Trade = { ts: number; price: number; size: number; usd: number; outcome: string }
const bySlug = new Map<string, Trade[]>()
let minTs = Infinity
let maxTs = 0
for (const line of readFileSync(activityPath, 'utf8').split('\n')) {
  if (!line) continue
  const r = JSON.parse(line)
  if (r.timestamp < minTs) minTs = r.timestamp
  if (r.timestamp > maxTs) maxTs = r.timestamp
  if (r.type !== 'TRADE' || r.side !== 'BUY') continue
  if (!r.slug?.startsWith('btc-updown-15m-')) continue
  let arr = bySlug.get(r.slug)
  if (!arr) bySlug.set(r.slug, (arr = []))
  arr.push({ ts: r.timestamp, price: r.price, size: r.size, usd: r.usdcSize, outcome: r.outcome })
}
console.log(`pull window: ${new Date(minTs * 1000).toISOString()} .. ${new Date(maxTs * 1000).toISOString()}`)

// keep markets with >=1h margins inside the pull window
const slugs = [...bySlug.keys()]
  .filter((s) => {
    const epoch = Number(s.split('-').pop())
    return epoch >= minTs + 3600 && epoch + 900 <= maxTs - 3600
  })
  .sort()
console.log(`btc-15m markets with fills, inside margins: ${slugs.length}`)

// winner per slug from telonex DB (result_id: '0' -> outcome0)
const dbRows = await listEligibleTelonexMarkets({
  symbol: 'btc',
  timeframe: '15m',
  converter: 'delta-typed',
  readFrom: 'r2',
  fromMs: (minTs - 3600) * 1000,
  toMs: (maxTs + 3600) * 1000,
  limit: 2000,
})
const winnerOf = new Map<string, string>()
for (const m of dbRows) {
  if (m.resultId === '0') winnerOf.set(m.slug, m.outcome0)
  else if (m.resultId === '1') winnerOf.set(m.slug, m.outcome1)
}

type Row = {
  slug: string
  fills: number
  upSh: number
  dnSh: number
  upUsd: number
  dnUsd: number
  pairCost: number
  pairRate: number
  excessSide: string
  excessSh: number
  excessAvgPx: number
  otherAvgPx: number
  winner: string | undefined
  excessWon: boolean | undefined
  grossPnl: number | undefined
  levelsUp: number
  levelsDn: number
  gapP50: number
}
const rows: Row[] = []
const q = (a: number[], p: number) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
for (const slug of slugs) {
  const ts = bySlug.get(slug)!.sort((a, b) => a.ts - b.ts)
  const up = ts.filter((t) => t.outcome === 'Up')
  const dn = ts.filter((t) => t.outcome === 'Down')
  const sum = (a: Trade[], f: (t: Trade) => number) => a.reduce((x, t) => x + f(t), 0)
  const upSh = sum(up, (t) => t.size)
  const dnSh = sum(dn, (t) => t.size)
  const upUsd = sum(up, (t) => t.usd)
  const dnUsd = sum(dn, (t) => t.usd)
  const avgUp = upSh ? upUsd / upSh : NaN
  const avgDn = dnSh ? dnUsd / dnSh : NaN
  const excessUp = upSh >= dnSh
  const winner = winnerOf.get(slug)
  const winSh = winner === 'Up' ? upSh : winner === 'Down' ? dnSh : undefined
  const gaps: number[] = []
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i].ts - ts[i - 1].ts)
  rows.push({
    slug,
    fills: ts.length,
    upSh,
    dnSh,
    upUsd,
    dnUsd,
    pairCost: avgUp + avgDn,
    pairRate: Math.max(upSh, dnSh) ? Math.min(upSh, dnSh) / Math.max(upSh, dnSh) : NaN,
    excessSide: excessUp ? 'Up' : 'Down',
    excessSh: Math.abs(upSh - dnSh),
    excessAvgPx: excessUp ? avgUp : avgDn,
    otherAvgPx: excessUp ? avgDn : avgUp,
    winner,
    excessWon: winner === undefined ? undefined : (excessUp ? 'Up' : 'Down') === winner,
    grossPnl: winSh === undefined ? undefined : winSh - (upUsd + dnUsd),
    levelsUp: new Set(up.map((t) => t.price)).size,
    levelsDn: new Set(dn.map((t) => t.price)).size,
    gapP50: q(gaps, 0.5),
  })
}

console.log('\nslug | fills | pairRate | pairCost | excess(side,sh,px) | other px | winner | excessWon | grossPnl | lvlsU/D | gapP50s')
for (const r of rows) {
  console.log(
    `${r.slug.slice(-10)} | ${r.fills} | ${r.pairRate.toFixed(2)} | ${r.pairCost.toFixed(3)} | ${r.excessSide} ${r.excessSh.toFixed(0)}sh @${r.excessAvgPx?.toFixed(2)} | ${r.otherAvgPx?.toFixed(2)} | ${r.winner ?? '?'} | ${r.excessWon === undefined ? '?' : r.excessWon ? 'YES' : 'no'} | ${r.grossPnl === undefined ? '?' : '$' + r.grossPnl.toFixed(0)} | ${r.levelsUp}/${r.levelsDn} | ${r.gapP50}`,
  )
}

const withWin = rows.filter((r) => r.excessWon !== undefined)
const excessWins = withWin.filter((r) => r.excessWon).length
const pnls = withWin.map((r) => r.grossPnl!) // same subset
const cheapExcess = rows.filter((r) => r.excessAvgPx < r.otherAvgPx).length
console.log(`\nmarkets with resolution: ${withWin.length}`)
console.log(`excess leg WON: ${excessWins}/${withWin.length} (${((100 * excessWins) / withWin.length).toFixed(0)}%)`)
console.log(`excess leg avg px (mean): ${(rows.reduce((a, r) => a + r.excessAvgPx, 0) / rows.length).toFixed(3)} vs other leg ${(rows.reduce((a, r) => a + r.otherAvgPx, 0) / rows.length).toFixed(3)}`)
console.log(`excess on CHEAPER side: ${cheapExcess}/${rows.length}`)
console.log(`pairRate p25/p50/p75: ${q(rows.map((r) => r.pairRate), 0.25).toFixed(2)}/${q(rows.map((r) => r.pairRate), 0.5).toFixed(2)}/${q(rows.map((r) => r.pairRate), 0.75).toFixed(2)}`)
console.log(`pairCost p25/p50/p75: ${q(rows.map((r) => r.pairCost), 0.25).toFixed(3)}/${q(rows.map((r) => r.pairCost), 0.5).toFixed(3)}/${q(rows.map((r) => r.pairCost), 0.75).toFixed(3)}`)
console.log(`gross PnL: total $${pnls.reduce((a, b) => a + b, 0).toFixed(0)}; per-market p10/p50/p90: $${q(pnls, 0.1).toFixed(0)}/$${q(pnls, 0.5).toFixed(0)}/$${q(pnls, 0.9).toFixed(0)}; losers: ${pnls.filter((x) => x < 0).length}/${pnls.length}`)
console.log(`ladder levels/side p50: up ${q(rows.map((r) => r.levelsUp), 0.5)}, down ${q(rows.map((r) => r.levelsDn), 0.5)}`)
console.log(`fills/market p25/p50/p75: ${q(rows.map((r) => r.fills), 0.25)}/${q(rows.map((r) => r.fills), 0.5)}/${q(rows.map((r) => r.fills), 0.75)}`)
console.log(`inter-fill gap p50 (median of per-market medians): ${q(rows.map((r) => r.gapP50).filter(Number.isFinite), 0.5)}s`)
const capital = rows.map((r) => r.upUsd + r.dnUsd)
console.log(`outlay/market p25/p50/p75: $${q(capital, 0.25).toFixed(0)}/$${q(capital, 0.5).toFixed(0)}/$${q(capital, 0.75).toFixed(0)}`)
process.exit(0)
