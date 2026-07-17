/**
 * lineage-sweep.ts — operator-lineage sweep across the class (A55).
 *
 * A54 found gabagool22→guh123: successor profile created 6m51s after
 * the predecessor's last trade. This script systematizes the check:
 * for every known class wallet, fetch (a) profile createdAt from
 * gamma public-profile, (b) last-activity timestamp from data-api
 * /activity (newest row), then print the creation-sorted roster and
 * every (wallet-A last activity → wallet-B profile creation) pair
 * with |delta| ≤ --window hours (default 72). Read-only, stdout only.
 *
 * Usage: npx tsx research/gabagool/scripts/lineage-sweep.ts [--window 72]
 */
const args = process.argv.slice(2)
const wi = args.indexOf('--window')
const WINDOW_H = wi >= 0 ? Number(args[wi + 1]) : 72

const WALLETS: Array<{ label: string; address: string }> = [
  { label: '52483137', address: '0x5248313731287b61d714ab9df655442d6ed28aa2' },
  { label: 'PurpleThunder', address: '0x589222a5124a96765443b97a3498d89ffd824ad2' },
  { label: 'CRYINGLITTLEBABY', address: '0x961afce6bd9aec79c5cf09d2d4dac2b434b23361' },
  { label: '93c22116', address: '0x93c22116e4402c9332ee6db578050e688934c072' },
  { label: 'gabagool22', address: '0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d' },
  { label: 'guh123', address: '0xa45fe11dd1420fca906ceac2c067844379a42429' },
  { label: 'livebreathevol', address: '0x818f214c7f3e479cce1d964d53fe3db7297558cb' },
  { label: 'vidarx', address: '0x2d8b401d2f0e6937afebf18e19e11ca568a5260a' },
  { label: 'b55f', address: '0xb55fa1296e6ec55d0ce53d93b9237389f11764d4' },
  { label: '0xce25', address: '0xce25e214d5cfe4f459cf67f08df581885aae7fdc' },
  { label: 'powerwinner', address: '0xf3531b23b504cf0aed4ff21325232b2a2d496685' },
  { label: 'bonereaper', address: '0xeebde7a0e019a63e6b476eb425505b7b3e6eba30' },
  { label: '0xaaaaa', address: '0x251c1a283703beed41590b0875a8dcb8ddd1541f' },
  { label: 'doggystyie', address: '0x0484e64092ba4108c2786b61e6fc052d3bf41b1a' },
  { label: 'badfallen', address: '0x3048d65321be3497164cdfc2996f94f98a2e7537' },
  { label: 'b27bc932', address: '0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82' },
  { label: '04b6d7e9', address: '0x04b6d7e930cf9e493c5e6ef24b496294f95594c8' },
  { label: '13e0d447', address: '0x13e0d447520ebe7f8eeaf7817211201b2c585204' },
  { label: '76d4d470', address: '0x76d4d4703add6e94cfdb1107f3d991d85ff2c512' },
  { label: '95f5', address: '0x95f51617e900f7d4df2894d77a73c1b2b269779f' },
]

async function getJson(url: string): Promise<any> {
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`)
      return await res.json()
    } catch (e) {
      if (a === 4) throw e
      await new Promise((r) => setTimeout(r, 800 * (a + 1)))
    }
  }
}

type Row = { label: string; address: string; createdAt: number; createdIso: string; name: string; lastTs: number | null; lastIso: string }
const rows: Row[] = []
for (const w of WALLETS) {
  const prof = await getJson(`https://gamma-api.polymarket.com/public-profile?address=${w.address}`)
  const act = await getJson(`https://data-api.polymarket.com/activity?user=${w.address}&limit=1&type=TRADE`)
  const lastTs = Array.isArray(act) && act.length ? act[0].timestamp : null
  if (!prof?.createdAt) {
    console.log(`!! ${w.label}: no public profile / createdAt (${JSON.stringify(prof).slice(0, 120)}); last trade ${lastTs ? new Date(lastTs * 1000).toISOString() : '-'}`)
    continue
  }
  rows.push({
    label: w.label,
    address: w.address,
    createdAt: Date.parse(prof.createdAt),
    createdIso: prof.createdAt.slice(0, 19) + 'Z',
    name: JSON.stringify(prof.name ?? prof.pseudonym ?? ''),
    lastTs,
    lastIso: lastTs ? new Date(lastTs * 1000).toISOString().slice(0, 19) + 'Z' : '-',
  })
  await new Promise((r) => setTimeout(r, 150))
}

console.log('== roster by profile createdAt ==')
for (const r of [...rows].sort((a, b) => a.createdAt - b.createdAt))
  console.log(`${r.createdIso}  ${r.label.padEnd(17)} last-activity ${r.lastIso}  ${r.name}`)

console.log(`\n== (last activity of A) -> (profile creation of B) pairs within ${WINDOW_H}h ==`)
const nowSec = (globalThis as any).process?.env?.SWEEP_NOW ? Number(process.env.SWEEP_NOW) : null
for (const a of rows) {
  if (a.lastTs === null) continue
  for (const b of rows) {
    if (a.address === b.address) continue
    const deltaH = (b.createdAt / 1000 - a.lastTs) / 3600
    if (Math.abs(deltaH) <= WINDOW_H)
      console.log(
        `${a.label} last ${a.lastIso}  ->  ${b.label} created ${b.createdIso}  delta ${deltaH >= 0 ? '+' : ''}${deltaH.toFixed(2)}h`,
      )
  }
}
if (nowSec) console.log('(SWEEP_NOW set: ignore — unused)')
process.exit(0)
