/**
 * atlas-classify.ts — W0 variant atlas: classify every wallet in the
 * era-scan outputs (data/variant-scan/scan-<day>.json) onto the class
 * design axes and print per-era cluster tables.
 *
 * Clusters (per wallet-day, crypto up/down books only — scan already
 * filtered to *-updown-* + dated up-or-down slugs):
 *   parity-edge     buyShare≥0.95, pairRate≥0.7, pairCost<1.000
 *   parity-farmer   buyShare≥0.95, pairRate≥0.7, pairCost≥1.000
 *   cheap-side      buyShare≥0.95, 0.15≤pairRate<0.7, pairCost<1.000
 *   buy-directional buyShare≥0.95, pairRate<0.15 (not the class)
 *   other-buyer     buyShare≥0.95, rest (incl. pairCost≥1 non-parity)
 *   two-way-mm      buyShare<0.95 (sells intra-window — classic MM /
 *                   sell-exit variants; adjacent, tracked separately)
 * Eligibility floor per wallet-day: fills≥50 AND notional≥$1,000
 * (below that, classification is noise).
 *
 * Usage: npx tsx research/gabagool/scripts/atlas-classify.ts
 *        [--dir research/gabagool/data/variant-scan] [--top 8]
 * Output: stdout markdown + <dir>/atlas-summary.json
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = argOf('dir') ?? 'research/gabagool/data/variant-scan'
const TOP = Number(argOf('top') ?? 8)

const KNOWN: Record<string, string> = {
  '0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d': 'gabagool22',
  '0xb55fa1296e6ec55d0ce53d93b9237389f11764d4': 'b55f',
  '0xce25e214d5cfe4f459cf67f08df581885aae7fdc': '0xce25',
  '0xf3531b23b504cf0aed4ff21325232b2a2d496685': 'powerwinner',
  '0xeebde7a0e019a63e6b476eb425505b7b3e6eba30': 'bonereaper',
  '0x251c1a283703beed41590b0875a8dcb8ddd1541f': '0xaaaaa',
  '0x0484e64092ba4108c2786b61e6fc052d3bf41b1a': 'doggystyie',
  '0x3048d65321be3497164cdfc2996f94f98a2e7537': 'badfallen',
  '0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82': 'b27bc932',
  '0x95f51617e900f7d4df2894d77a73c1b2b269779f': '95f5',
  '0x096924c49e7b92ad96ac6b573dc977398e4a6df3': 'drfc(unconf)',
}
// prefix…suffix patterns for wallets whose full address we lack
const KNOWN_PARTIAL: Array<{ label: string; pre: string; suf: string }> = [
  { label: 'HelixEdge', pre: '0x2ebd6425', suf: '38cf' },
  { label: 'neutralwave23', pre: '0x5b6331e7', suf: '11a4' },
]

type Row = {
  wallet: string
  markets: number
  fills: number
  notional: number
  buyShare: number
  makerShare: number
  pairRate: number
  pairCost: number
  clipP50: number
  books: Record<string, number>
}

function classify(r: Row): string {
  if (r.buyShare < 0.95) return 'two-way-mm'
  if (r.pairCost == null || r.pairRate < 0.15) return 'buy-directional'
  if (r.pairRate >= 0.7) return r.pairCost < 1.0 ? 'parity-edge' : 'parity-farmer'
  if (r.pairCost < 1.0) return 'cheap-side'
  return 'other-buyer'
}

function label(addr: string): string {
  if (KNOWN[addr]) return KNOWN[addr]
  for (const k of KNOWN_PARTIAL) if (addr.startsWith(k.pre) && addr.endsWith(k.suf)) return k.label
  return ''
}

const topBook = (books: Record<string, number>) =>
  Object.entries(books)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k.replace(/-\d{4}.*$/, '')} $${(v / 1000).toFixed(1)}k`)
    .join(', ')

const files = readdirSync(dir)
  .filter((f) => /^scan-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
const summary: any[] = []
for (const f of files) {
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  const day: string = j.day
  const rows: Row[] = (j.wallets as Row[]).filter((r) => r.fills >= 50 && r.notional >= 1000)
  const clusters = new Map<string, Row[]>()
  for (const r of rows) {
    const c = classify(r)
    if (!clusters.has(c)) clusters.set(c, [])
    clusters.get(c)!.push(r)
  }
  console.log(`\n## ${day} — ${rows.length} wallets ≥50 fills & ≥$1k (of ${j.wallets.length} seen; ${j.windows} windows sampled ×${j.every})`)
  console.log(`| cluster | wallets | Σnotional | med pairCost | med clip | med makerShare | known members |`)
  console.log(`|---|---|---|---|---|---|---|`)
  const clusterOut: any = {}
  for (const c of ['parity-edge', 'parity-farmer', 'cheap-side', 'two-way-mm', 'buy-directional', 'other-buyer']) {
    const rs = (clusters.get(c) ?? []).sort((a, b) => b.notional - a.notional)
    if (!rs.length) continue
    const med = (sel: (r: Row) => number) => {
      const v = rs.map(sel).filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y)
      return v.length ? v[Math.floor(v.length / 2)] : NaN
    }
    const knowns = rs.map((r) => label(r.wallet)).filter(Boolean)
    console.log(
      `| ${c} | ${rs.length} | $${Math.round(rs.reduce((s, r) => s + r.notional, 0) / 1000)}k | ${med((r) => r.pairCost).toFixed(3)} | $${med((r) => r.clipP50).toFixed(1)} | ${med((r) => r.makerShare).toFixed(2)} | ${knowns.join(' ') || '—'} |`,
    )
    clusterOut[c] = {
      n: rs.length,
      notional: Math.round(rs.reduce((s, r) => s + r.notional, 0)),
      top: rs.slice(0, TOP).map((r) => ({
        wallet: r.wallet,
        label: label(r.wallet) || undefined,
        notional: Math.round(r.notional),
        fills: r.fills,
        markets: r.markets,
        pairRate: r.pairRate,
        pairCost: r.pairCost,
        clipP50: r.clipP50,
        makerShare: r.makerShare,
        topBooks: topBook(r.books),
      })),
    }
  }
  // top wallets of the class clusters, for the atlas narrative
  for (const c of ['parity-edge', 'parity-farmer', 'cheap-side']) {
    const rs = (clusters.get(c) ?? []).sort((a, b) => b.notional - a.notional).slice(0, TOP)
    if (!rs.length) continue
    console.log(`\n### top ${c} (${day})`)
    for (const r of rs)
      console.log(
        `- ${label(r.wallet) || r.wallet.slice(0, 10)}  n=$${(r.notional / 1000).toFixed(1)}k mkts=${r.markets} fills=${r.fills} pair=${r.pairRate.toFixed(2)}@${r.pairCost.toFixed(3)} maker=${r.makerShare.toFixed(2)} clip=$${r.clipP50.toFixed(1)}  ${topBook(r.books)}`,
      )
  }
  summary.push({ day, eligible: rows.length, seen: j.wallets.length, clusters: clusterOut })
}
writeFileSync(join(dir, 'atlas-summary.json'), JSON.stringify(summary, null, 1))
console.log(`\nwrote ${join(dir, 'atlas-summary.json')}`)
