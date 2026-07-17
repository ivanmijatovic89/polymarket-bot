/**
 * live-shadow.ts — W3: periodic snapshot of the live pair-accumulation meta.
 *
 * For each tracked wallet, pulls the last --hours (default 2) of data-api
 * /activity (all types, end-cursor walking per pull-activity.ts API facts:
 * offset caps at 3000, second timestamps, never content-dedupe), then
 * summarizes per wallet over crypto up/down books:
 *   fills, notional, buy share, maker-visible pair rate/cost per market
 *   (same formulas as variant-scan.ts: pairRate = Σmin(upSh,dnSh)/Σmax,
 *   pairCost = min-leg-weighted avgUpPx+avgDnPx over markets with both
 *   legs), MERGE/REDEEM counts, book mix.
 *
 * Usage: npx tsx research/gabagool/scripts/live-shadow.ts [--hours 2]
 *        [--out research/gabagool/data/live-shadow]
 *
 * Output: <out>/shadow-<ISO-hour>.json + a markdown table block on stdout
 * (append it to measurements/live-shadow.md). Read-only outside <out>.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const hours = Number(argOf('hours') ?? 2)
const outDir = argOf('out') ?? 'research/gabagool/data/live-shadow'
mkdirSync(outDir, { recursive: true })

const WALLETS: Array<{ label: string; address: string }> = [
  { label: 'b55f', address: '0xb55fa1296e6ec55d0ce53d93b9237389f11764d4' },
  { label: '0xce25', address: '0xce25e214d5cfe4f459cf67f08df581885aae7fdc' },
  { label: 'powerwinner', address: '0xf3531b23b504cf0aed4ff21325232b2a2d496685' },
  { label: 'bonereaper', address: '0xeebde7a0e019a63e6b476eb425505b7b3e6eba30' },
  { label: '0xaaaaa', address: '0x251c1a283703beed41590b0875a8dcb8ddd1541f' },
  { label: 'doggystyie', address: '0x0484e64092ba4108c2786b61e6fc052d3bf41b1a' },
  { label: 'badfallen', address: '0x3048d65321be3497164cdfc2996f94f98a2e7537' },
  { label: 'b27bc932', address: '0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82' },
  { label: '95f5-challenger', address: '0x95f51617e900f7d4df2894d77a73c1b2b269779f' },
]

async function getJson(url: string): Promise<any> {
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`${res.status}`)
      return await res.json()
    } catch (e) {
      if (a === 4) throw e
      await new Promise((r) => setTimeout(r, 700 * (a + 1)))
    }
  }
}

// Recover the failed challenger's full address from the volume leaderboard
// (committed files only carry 0x95f51617…779f).
try {
  const lb = await getJson('https://lb-api.polymarket.com/volume?window=30d&limit=100')
  const hit = (lb as Array<{ proxyWallet: string }>).find(
    (r) => r.proxyWallet?.toLowerCase().startsWith('0x95f51617') && r.proxyWallet?.toLowerCase().endsWith('779f'),
  )
  if (hit) WALLETS.push({ label: '95f5-challenger', address: hit.proxyWallet.toLowerCase() })
  else console.error('(95f5 challenger not in top-100 30d volume — skipped)')
} catch (e) {
  console.error(`lb-api lookup failed: ${String(e).slice(0, 80)}`)
}

const nowSec = Math.floor(Date.now() / 1000)
const startSec = nowSec - hours * 3600
const UPDOWN = /-updown-|-up-or-down-/
const familyOf = (slug: string) => slug.replace(/-\d+$/, '')

type Row = {
  timestamp: number
  type: string
  side?: string
  size: number
  usdcSize: number
  price?: number
  slug: string
  outcome?: string
}

async function pullWindow(address: string): Promise<Row[]> {
  const rows: Row[] = []
  let end = nowSec
  for (let guard = 0; guard < 30; guard++) {
    let windowRows: Row[] = []
    let hitCap = false
    for (let offset = 0; offset <= 3000; offset += 500) {
      const page = (await getJson(
        `https://data-api.polymarket.com/activity?user=${address}&limit=500&offset=${offset}&start=${startSec}&end=${end}`,
      )) as Row[]
      windowRows.push(...page)
      if (page.length < 500) break
      if (offset === 3000) hitCap = true
      await new Promise((r) => setTimeout(r, 120))
    }
    if (!hitCap) {
      rows.push(...windowRows)
      break
    }
    // offset cap: oldest second may be partial — keep rows newer than it,
    // continue with end = that second (inclusive refetch)
    const oldest = Math.min(...windowRows.map((r) => r.timestamp))
    rows.push(...windowRows.filter((r) => r.timestamp > oldest))
    end = oldest
  }
  return rows
}

type Summary = {
  label: string
  address: string
  fills: number
  notional: number
  buyShare: number | null
  merges: number
  redeems: number
  pairRate: number | null
  pairCost: number | null
  clipP50: number | null
  books: Record<string, number>
}

const summaries: Summary[] = []
for (const w of WALLETS) {
  const rows = await pullWindow(w.address)
  const trades = rows.filter((r) => r.type === 'TRADE' && UPDOWN.test(r.slug ?? ''))
  const merges = rows.filter((r) => r.type === 'MERGE').length
  const redeems = rows.filter((r) => r.type === 'REDEEM').length
  const byMarket = new Map<string, { upSh: number; upN: number; dnSh: number; dnN: number }>()
  let buyN = 0
  let sellN = 0
  const clips: number[] = []
  const books = new Map<string, number>()
  for (const t of trades) {
    if (t.side === 'BUY') buyN += t.usdcSize
    else sellN += t.usdcSize
    clips.push(t.usdcSize)
    books.set(familyOf(t.slug), (books.get(familyOf(t.slug)) ?? 0) + t.usdcSize)
    if (t.side !== 'BUY') continue
    let m = byMarket.get(t.slug)
    if (!m) {
      m = { upSh: 0, upN: 0, dnSh: 0, dnN: 0 }
      byMarket.set(t.slug, m)
    }
    if ((t.outcome ?? '').toLowerCase() === 'up') {
      m.upSh += t.size
      m.upN += t.usdcSize
    } else {
      m.dnSh += t.size
      m.dnN += t.usdcSize
    }
  }
  let pairMin = 0
  let pairMax = 0
  let pcNum = 0
  let pcDen = 0
  for (const m of byMarket.values()) {
    pairMin += Math.min(m.upSh, m.dnSh)
    pairMax += Math.max(m.upSh, m.dnSh)
    if (m.upSh > 0 && m.dnSh > 0) {
      const pc = m.upN / m.upSh + m.dnN / m.dnSh
      pcNum += pc * Math.min(m.upSh, m.dnSh)
      pcDen += Math.min(m.upSh, m.dnSh)
    }
  }
  clips.sort((a, b) => a - b)
  const total = buyN + sellN
  summaries.push({
    label: w.label,
    address: w.address,
    fills: trades.length,
    notional: +total.toFixed(0),
    buyShare: total > 0 ? +(buyN / total).toFixed(3) : null,
    merges,
    redeems,
    pairRate: pairMax > 0 ? +(pairMin / pairMax).toFixed(3) : null,
    pairCost: pcDen > 0 ? +(pcNum / pcDen).toFixed(4) : null,
    clipP50: clips.length ? +clips[Math.floor(clips.length / 2)].toFixed(2) : null,
    books: Object.fromEntries(
      [...books.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(0)]),
    ),
  })
  console.error(`${w.label}: ${rows.length} rows, ${trades.length} updown trades`)
}

const stamp = new Date(nowSec * 1000).toISOString().slice(0, 13) + 'Z'
writeFileSync(join(outDir, `shadow-${stamp}.json`), JSON.stringify({ stamp, hours, summaries }, null, 1))

// markdown block for measurements/live-shadow.md
console.log(`\n### ${stamp} (last ${hours}h)\n`)
console.log('| wallet | fills | notional | BUY% | pairRate | pairCost | clip p50 | merges | redeems | top books |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
for (const s of summaries) {
  const top = Object.entries(s.books)
    .slice(0, 3)
    .map(([k, v]) => `${k.replace('-updown', '')} $${Math.round(v / 100) / 10}k`)
    .join(', ')
  console.log(
    `| ${s.label} | ${s.fills} | $${s.notional} | ${s.buyShare ?? '-'} | ${s.pairRate ?? '-'} | ${s.pairCost ?? '-'} | $${s.clipP50 ?? '-'} | ${s.merges} | ${s.redeems} | ${top || '(idle)'} |`,
  )
}
