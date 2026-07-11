/**
 * scr009-draw.ts — the frozen SCR-009 sample draw (BATCH-004 mini-spec).
 *
 * Uniform random draw of N=2000 slugs from the eligible RESERVE window
 * (market_start_ms in [1772323200000, 1777237199999]) per D53 (SIGNAL-FILLS
 * amendment 3): seeded Fisher-Yates (seed "SCR-009-draw-1", djb2-hashed
 * LCG) over the full eligible reserve slug list ordered by
 * market_start_ms ASC, first 2000 taken, split round-robin into 6
 * disjoint shard files logs/SCR-009-shard[0-5].slugs. Outcome-free
 * (slugs only) and reproducible.
 */
import { writeFileSync } from 'node:fs'
import { listEligibleTelonexMarkets } from '../../src/db/telonexMarkets.js'
import { closeDb } from '../../src/db/index.js'

const FROM_MS = 1772323200000
const TO_MS = 1777237199999
const N = 2000
const SHARDS = 6
const SEED = 'SCR-009-draw-1'

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

async function main() {
  const all = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local-or-download-from-r2-to-local',
    limit: 50000,
  })
  const reserve = all
    .filter((m) => m.marketStartMs >= FROM_MS && m.marketStartMs <= TO_MS)
    .sort((a, b) => a.marketStartMs - b.marketStartMs)
  console.log(`eligible reserve-window markets: ${reserve.length}`)
  const rnd = lcg(djb2(SEED))
  const arr = reserve.map((m) => m.slug)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  const drawn = arr.slice(0, N)
  const shards: string[][] = Array.from({ length: SHARDS }, () => [])
  drawn.forEach((s, i) => shards[i % SHARDS].push(s))
  shards.forEach((s, k) => {
    writeFileSync(`fable-lab/logs/SCR-009-shard${k}.slugs`, s.join(',') + '\n')
    console.log(`shard${k}: ${s.length} slugs`)
  })
  console.log(`drawn ${drawn.length} of ${reserve.length} (seed ${SEED})`)
  await closeDb()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
