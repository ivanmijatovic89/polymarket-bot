/**
 * drift-features.ts — OPEN-QUESTIONS #1 (session 8): what book-state
 * precedes a RESTING fill with favorable post-fill drift?
 *
 * For each wallet's non-taker BUY fills (price < bestAsk at fill time)
 * on btc-15m books: pre-fill features from the same asset's book series
 *   preDrift10/30 = mid(t) − mid(t−10s/−30s)   (momentum into the fill)
 *   spread at fill, minute of window, eventRate5s (book events in the
 *   last 5s — sweep activity), depthBelow = fillPrice − bestBid (how
 *   deep the level sat)
 * and postDrift60 = mid(t+60s) − mid(t) (the A39 discriminator).
 *
 * Output per wallet: feature means for favorable (post>0) vs adverse
 * (post<0) fills, correlation(preDrift30, postDrift60), and the
 * cross-wallet comparison of pre-fill states.
 *
 * Usage: npx tsx research/gabagool/scripts/drift-features.ts \
 *   --dir research/gabagool/data/telonex-r2 \
 *   --wallets 04b6d7e9=research/gabagool/data/activity-04b6d7e9-jun12-14.jsonl,b27bc932=research/gabagool/data/activity-b27bc932-jun.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dir = argOf('dir') ?? 'research/gabagool/data/telonex-r2'
const walletSpecs = (argOf('wallets') ?? '').split(',').map((s) => {
  const [label, path] = s.split('=')
  return { label, path }
})

type Fill = { tsMs: number; price: number; size: number; assetId: string; wallet: string }
const fillsBySlug = new Map<string, Fill[]>()
for (const { label, path } of walletSpecs) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue
    const r = JSON.parse(line)
    if (r.type !== 'TRADE' || r.side !== 'BUY') continue
    if (!r.slug?.startsWith('btc-updown-15m-')) continue
    if (!r.asset || !r.price || !r.size) continue
    let arr = fillsBySlug.get(r.slug)
    if (!arr) fillsBySlug.set(r.slug, (arr = []))
    arr.push({ tsMs: r.timestamp * 1000, price: r.price, size: r.size, assetId: String(r.asset), wallet: label })
  }
}

const slugs = readdirSync(dir)
  .filter((f) => f.startsWith('btc-updown-15m-') && f.endsWith('.parquet'))
  .map((f) => f.replace('.parquet', ''))
  .filter((s) => fillsBySlug.has(s))
  .sort()
console.log(`markets joined: ${slugs.length}`)

type Row = {
  wallet: string
  preDrift10: number
  preDrift30: number
  post60: number
  spread: number
  depthBelow: number
  eventRate5s: number
  minute: number
}
const rows: Row[] = []

for (const slug of slugs) {
  const epochMs = Number(slug.split('-').pop()) * 1000
  const series = new Map<string, Array<{ ts: number; bid: number | null; ask: number | null }>>()
  const last = new Map<string, { bid: number | null; ask: number | null }>()
  await replayTelonexDeltaParquetForMarket({
    filePath: join(dir, `${slug}.parquet`),
    onSnapshot: (snapshot) => {
      for (const [assetId, book] of Object.entries(snapshot.byAssetId)) {
        const bid = (book as { bestBid: number | null }).bestBid
        const ask = (book as { bestAsk: number | null }).bestAsk
        const prev = last.get(assetId)
        if (!prev || prev.bid !== bid || prev.ask !== ask) {
          last.set(assetId, { bid, ask })
          let arr = series.get(assetId)
          if (!arr) series.set(assetId, (arr = []))
          arr.push({ ts: snapshot.timestamp, bid, ask })
        }
      }
    },
  })
  const at = (s: Array<{ ts: number; bid: number | null; ask: number | null }>, t: number) => {
    let lo = 0, hi = s.length - 1, best = -1
    while (lo <= hi) {
      const m = (lo + hi) >> 1
      if (s[m].ts <= t) { best = m; lo = m + 1 } else hi = m - 1
    }
    return best
  }
  const midAt = (s: Array<{ ts: number; bid: number | null; ask: number | null }>, t: number) => {
    const i = at(s, t)
    if (i < 0) return null
    const st = s[i]
    return st.bid !== null && st.ask !== null ? (st.bid + st.ask) / 2 : null
  }
  for (const f of fillsBySlug.get(slug)!) {
    const s = series.get(f.assetId)
    if (!s || !s.length) continue
    const i = at(s, f.tsMs)
    if (i < 0) continue
    const st = s[i]
    if (st.bid === null || st.ask === null) continue
    if (f.price >= st.ask) continue // taker — exclude; resting fills only
    const m0 = midAt(s, f.tsMs)
    const m10 = midAt(s, f.tsMs - 10_000)
    const m30 = midAt(s, f.tsMs - 30_000)
    const p60 = midAt(s, f.tsMs + 60_000)
    if (m0 === null || m10 === null || m30 === null || p60 === null) continue
    let cnt = 0
    for (let k = i; k >= 0 && s[k].ts >= f.tsMs - 5000; k--) cnt++
    rows.push({
      wallet: f.wallet,
      preDrift10: m0 - m10,
      preDrift30: m0 - m30,
      post60: p60 - m0,
      spread: st.ask - st.bid,
      depthBelow: f.price - st.bid,
      eventRate5s: cnt,
      minute: Math.min(14, Math.floor((f.tsMs - epochMs) / 60_000)),
    })
  }
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}
const f4 = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : '-')
for (const { label } of walletSpecs) {
  const g = rows.filter((r) => r.wallet === label)
  const fav = g.filter((r) => r.post60 > 0)
  const adv = g.filter((r) => r.post60 < 0)
  console.log(`\n== ${label}: ${g.length} resting fills | favorable ${fav.length} (${((100 * fav.length) / g.length).toFixed(0)}%) adverse ${adv.length}`)
  console.log(`   mean post60: ${f4(mean(g.map((r) => r.post60)))}`)
  for (const [name, get] of [
    ['preDrift10', (r: Row) => r.preDrift10],
    ['preDrift30', (r: Row) => r.preDrift30],
    ['spread', (r: Row) => r.spread],
    ['depthBelow', (r: Row) => r.depthBelow],
    ['eventRate5s', (r: Row) => r.eventRate5s],
    ['minute', (r: Row) => r.minute],
  ] as Array<[string, (r: Row) => number]>) {
    console.log(`   ${name}: all ${f4(mean(g.map(get)))} | fav ${f4(mean(fav.map(get)))} | adv ${f4(mean(adv.map(get)))}`)
  }
  console.log(`   corr(preDrift30, post60): ${f4(corr(g.map((r) => r.preDrift30), g.map((r) => r.post60)))}`)
  console.log(`   corr(preDrift10, post60): ${f4(corr(g.map((r) => r.preDrift10), g.map((r) => r.post60)))}`)
}
process.exit(0)
