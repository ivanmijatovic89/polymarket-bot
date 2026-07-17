/**
 * challenger-timeline.ts — W1 recon: daily activity-intensity map for the
 * failed challenger 0x95f5…779f (or any --address) without a full pull.
 *
 * Per UTC day in [--from, --to]: one /activity page (limit 500, newest-first
 * within the day). If the page is full (500 rows), the day's fill count is
 * estimated by density extrapolation: 500 rows span [oldestTs..dayEnd] →
 * fills/day ≈ 500 * 86400/span; notional/day scaled the same way. If the
 * page is short, counts are exact. Good enough to find the ramp, the peak,
 * and the collapse; deep-dive days get full pulls later.
 *
 * Usage: npx tsx research/gabagool/scripts/challenger-timeline.ts \
 *   --address 0x… --from 2026-04-01 --to 2026-07-17
 *   [--out research/gabagool/data/challenger-timeline.json]
 */
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const address = argOf('address') ?? '0x95f51617e900f7d4df2894d77a73c1b2b269779f'
const from = argOf('from') ?? '2026-04-01'
const to = argOf('to') ?? '2026-07-17'
const outPath = argOf('out') ?? 'research/gabagool/data/challenger-timeline.json'

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

const fromSec = Date.parse(`${from}T00:00:00Z`) / 1000
const toSec = Date.parse(`${to}T00:00:00Z`) / 1000
const days: any[] = []
for (let d = fromSec; d <= toSec; d += 86400) {
  const dayEnd = d + 86399
  const page = (await getJson(
    `https://data-api.polymarket.com/activity?user=${address}&limit=500&start=${d}&end=${dayEnd}`,
  )) as Array<{ timestamp: number; type: string; side?: string; usdcSize: number; slug?: string }>
  const iso = new Date(d * 1000).toISOString().slice(0, 10)
  if (page.length === 0) {
    days.push({ day: iso, fills: 0, estNotional: 0, exact: true })
    process.stdout.write(`${iso} 0\n`)
    continue
  }
  const trades = page.filter((r) => r.type === 'TRADE')
  const merges = page.filter((r) => r.type === 'MERGE').length
  const buyN = trades.filter((r) => r.side === 'BUY').reduce((s, r) => s + r.usdcSize, 0)
  const sellN = trades.filter((r) => r.side !== 'BUY').reduce((s, r) => s + r.usdcSize, 0)
  const books = new Map<string, number>()
  for (const t of trades) {
    const fam = (t.slug ?? '?').replace(/-\d+$/, '')
    books.set(fam, (books.get(fam) ?? 0) + t.usdcSize)
  }
  const full = page.length === 500
  const oldest = Math.min(...page.map((r) => r.timestamp))
  const span = Math.max(1, dayEnd - oldest)
  const scale = full ? 86400 / span : 1
  days.push({
    day: iso,
    fills: Math.round(trades.length * scale),
    estNotional: Math.round((buyN + sellN) * scale),
    buyShare: buyN + sellN > 0 ? +(buyN / (buyN + sellN)).toFixed(3) : null,
    mergesPerPage: merges,
    exact: !full,
    topBooks: [...books.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
  })
  process.stdout.write(
    `${iso} fills≈${days.at(-1).fills} notional≈$${days.at(-1).estNotional} buy=${days.at(-1).buyShare} merges/pg=${merges}${full ? '' : ' (exact)'}\n`,
  )
  await new Promise((r) => setTimeout(r, 150))
}
writeFileSync(outPath, JSON.stringify({ address, from, to, days }, null, 1))
console.log(`wrote ${outPath}`)
