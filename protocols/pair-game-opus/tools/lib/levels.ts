/**
 * lib/levels.ts — the level ladder and the fixed market universe.
 *
 * One definition, imported by level.ts (the evaluator) and play-level.ts (the
 * launcher), so a level's market set can never differ between "what we ran" and
 * "what we scored".
 *
 * LEVELS.md: level N requires the first N markets, with a fixed target of
 * 1,000 matched shares in every market.
 *
 * RULES.md: btc 15m only, telonex delta datasets from 2026-04-02 onward,
 * chronological order, "first N markets" = first N eligible from that floor.
 */
import { listEligibleTelonexMarkets } from '../../../../src/db/telonexMarkets.js'

export const FLOOR_MS = 1775088000000 // 2026-04-02T00:00:00Z
export const PAIR_CEILING = 0.98
export const TARGET_MATCHED_SHARES = 1000
export const MAX_BUY_ORDER_SIZE = 200
export const REQUIRED_LATENCY_DELAY_MS = 140
export const REQUIRED_LATENCY_JITTER_MS = 20
export const PROTOCOL = 'pair-game-opus'
export type LevelSpec = { level: number; markets: number; qty: number }

export function levelSpec(level: number): LevelSpec {
  if (!Number.isInteger(level) || level < 1)
    throw new Error(`level must be a positive integer, got ${level}`)
  return {
    level,
    markets: level,
    qty: TARGET_MATCHED_SHARES,
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
