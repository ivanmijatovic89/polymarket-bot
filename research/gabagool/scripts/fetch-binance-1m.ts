/**
 * fetch-binance-1m.ts — cache Binance BTCUSDT 1m klines for given UTC days.
 * Used as the realized-vol covariate for session-split-vol.ts (OQ #2).
 *
 * Usage: npx tsx research/gabagool/scripts/fetch-binance-1m.ts 2026-03-25 2026-04-15 ...
 * Output: research/gabagool/data/binance-1m-<date>.json  (array of [openTimeMs, open, high, low, close])
 */
import { existsSync, writeFileSync } from 'node:fs'

const days = process.argv.slice(2)
if (!days.length) {
  console.error('usage: fetch-binance-1m.ts <YYYY-MM-DD> ...')
  process.exit(1)
}

const BASES = ['https://api.binance.com', 'https://data-api.binance.vision']

async function fetchKlines(startMs: number, endMs: number): Promise<unknown[]> {
  for (const base of BASES) {
    try {
      const url = `${base}/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${startMs}&endTime=${endMs}&limit=1000`
      const res = await fetch(url)
      if (!res.ok) continue
      const body = (await res.json()) as unknown[]
      if (Array.isArray(body)) return body
    } catch {
      /* try next base */
    }
  }
  throw new Error(`all bases failed for ${new Date(startMs).toISOString()}`)
}

for (const day of days) {
  const out = `research/gabagool/data/binance-1m-${day}.json`
  if (existsSync(out)) {
    console.log(`${day}: cached`)
    continue
  }
  const dayStart = Date.parse(`${day}T00:00:00Z`)
  const rows: Array<[number, number, number, number, number]> = []
  for (let t = dayStart; t < dayStart + 86_400_000; t += 1000 * 60_000) {
    const kl = await fetchKlines(t, Math.min(t + 1000 * 60_000, dayStart + 86_400_000) - 1)
    for (const k of kl as Array<[number, string, string, string, string]>) {
      rows.push([k[0], Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4])])
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  writeFileSync(out, JSON.stringify(rows))
  console.log(`${day}: ${rows.length} candles -> ${out}`)
}
