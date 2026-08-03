/**
 * lib/levels.ts — the level ladder and the fixed market universe.
 *
 * One definition, imported by level.ts (the evaluator) and play-level.ts (the
 * launcher), so a level's market set can never differ between "what we ran" and
 * "what we scored".
 *
 * LEVELS.md:
 *   markets  = floor((L-1)/5) + 1
 *   quantity = [10, 50, 200, 1000, 3000][(L-1) mod 5]
 *
 * RULES.md: btc 15m only, telonex delta datasets from 2026-04-02 onward,
 * chronological order, "first N markets" = first N eligible from that floor.
 */
import { listEligibleTelonexMarkets } from '../../../../src/db/telonexMarkets.js'

export const FLOOR_MS = 1775088000000 // 2026-04-02T00:00:00Z
export const QUANTITY_LADDER = [10, 50, 200, 1000, 3000] as const
export const PAIR_CEILING = 0.98
export const REQUIRED_LATENCY_DELAY_MS = 140
export const REQUIRED_LATENCY_JITTER_MS = 20
export const PROTOCOL = 'pair-game-opus'
export const MAX_LEVEL = 300

export type LevelSpec = { level: number; markets: number; qty: number }

export function levelSpec(level: number): LevelSpec {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL)
    throw new Error(`level must be an integer in 1..${MAX_LEVEL}, got ${level}`)
  return {
    level,
    markets: Math.floor((level - 1) / 5) + 1,
    qty: QUANTITY_LADDER[(level - 1) % 5]!,
  }
}

/** The first `count` eligible markets, chronologically — the level's universe. */
export async function levelSlugs(count: number): Promise<string[]> {
  const markets = await listEligibleTelonexMarkets({
    symbol: 'btc',
    timeframe: '15m',
    converter: 'delta-typed',
    readFrom: 'local-or-download-from-r2-to-local',
    fromMs: FLOOR_MS,
    limit: count,
  })
  if (markets.length !== count)
    throw new Error(`universe has only ${markets.length} eligible markets, need ${count}`)
  return markets.map((m) => m.slug)
}
