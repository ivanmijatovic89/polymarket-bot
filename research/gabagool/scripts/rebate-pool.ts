/**
 * rebate-pool.ts — estimate the daily maker-rebate pool for one book
 * (G4 feasibility): sample N btc-15m windows across a UTC day, pull ALL
 * data-api /trades rows per market (verified single-counted: sum(size)
 * == gamma volumeNum), apply the current fee curve 0.07*p*(1-p)/share
 * (taker-only), extrapolate to the full day. Pool = 20% x total fees.
 *
 * Usage: npx tsx research/gabagool/scripts/rebate-pool.ts \
 *   --day 2026-07-15 [--prefix btc-updown-15m] [--every 4]
 */
const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const day = argOf('day') ?? '2026-07-15'
const prefix = argOf('prefix') ?? 'btc-updown-15m'
const every = Number(argOf('every') ?? 4)

const dayStartSec = Date.parse(`${day}T00:00:00Z`) / 1000
const results: Array<{ slug: string; trades: number; shares: number; notional: number; fees: number }> = []

async function getJson(url: string): Promise<unknown> {
  for (let a = 0; a < 5; a++) {
    const res = await fetch(url)
    if (res.ok) return res.json()
    await new Promise((r) => setTimeout(r, 500 * (a + 1)))
  }
  throw new Error(`failed: ${url}`)
}

for (let w = 0; w < 96; w += every) {
  const epoch = dayStartSec + w * 900
  const slug = `${prefix}-${epoch}`
  let market: { conditionId?: string } | null = null
  try {
    market = (await getJson(`https://gamma-api.polymarket.com/markets/slug/${slug}`)) as { conditionId?: string }
  } catch {
    console.error(`no market: ${slug}`)
    continue
  }
  if (!market?.conditionId) continue
  let rows: Array<{ price: number; size: number }> = []
  for (let off = 0; ; off += 500) {
    const page = (await getJson(
      `https://data-api.polymarket.com/trades?market=${market.conditionId}&limit=500&offset=${off}`,
    )) as Array<{ price: number; size: number }>
    rows = rows.concat(page)
    if (page.length < 500) break
    if (off >= 4000) {
      console.error(`${slug}: offset cap hit at ${rows.length} rows — fees are a LOWER bound for this market`)
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  const shares = rows.reduce((a, r) => a + r.size, 0)
  const notional = rows.reduce((a, r) => a + r.size * r.price, 0)
  const fees = rows.reduce((a, r) => a + 0.07 * r.price * (1 - r.price) * r.size, 0)
  results.push({ slug, trades: rows.length, shares, notional, fees })
  console.log(
    `${slug}  trades=${rows.length}  shares=${shares.toFixed(0)}  notional=$${notional.toFixed(0)}  fees=$${fees.toFixed(2)}`,
  )
}

const tot = (k: 'trades' | 'shares' | 'notional' | 'fees') => results.reduce((a, r) => a + r[k], 0)
const scale = 96 / results.length
console.log(`\nsampled ${results.length}/96 windows of ${day}`)
console.log(`sample totals: trades ${tot('trades')}, notional $${tot('notional').toFixed(0)}, fees $${tot('fees').toFixed(2)}`)
console.log(`day estimate (x${scale.toFixed(2)}): notional $${(tot('notional') * scale).toFixed(0)}, taker fees $${(tot('fees') * scale).toFixed(0)}`)
console.log(`implied daily maker-rebate pool (20%): $${(tot('fees') * scale * 0.2).toFixed(0)}`)
const fees = results.map((r) => r.fees).sort((a, b) => a - b)
console.log(`per-market fees p10/p50/p90: $${fees[Math.floor(0.1 * fees.length)].toFixed(0)} / $${fees[Math.floor(0.5 * fees.length)].toFixed(0)} / $${fees[Math.floor(0.9 * fees.length)].toFixed(0)}`)
process.exit(0)
