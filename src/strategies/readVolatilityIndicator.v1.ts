import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import type { Plugin } from '../strategy/plugins/PluginSet.js'
import type { VolatilitySnapshot } from '../strategy/plugins/TimeWindowVolatility.js'
import { TimeWindowVolatility } from '../strategy/plugins/TimeWindowVolatility.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  /**
   * Optional: restrict logs to a specific assetId (token id).
   * If omitted, we pick the first assetId in the snapshot (sorted).
   */
  assetId: z.string().min(1).optional(),
  /**
   * Log throttling. Keeps the strategy cheap even at high tick rates.
   */
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'readVolatilityIndicator.v1',
  title: 'Read volatility indicator (example) v1',
  description:
    'Example strategy: constructs a TimeWindowVolatility indicator (bestAsk) and logs 1/2/3/5/10/30/60s stats on market ticks.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  const windows = {
    '1s': 1_000,
    '2s': 2_000,
    '3s': 3_000,
    '5s': 5_000,
    '10s': 10_000,
    '30s': 30_000,
    '60s': 60_000,
  } as const

  const plugins: Plugin[] = [new TimeWindowVolatility({ windows })]

  const name = 'read_volatility_indicator'
  let lastLogAtMs = 0

  function fmt(v: number | null | undefined): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    // Polymarket prices are probability-ish; keep it readable but precise enough.
    return Number(v.toFixed(6))
  }

  function fmtCents(v: number | null | undefined): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    // Terminal-only: show probability prices in "cents" (x100), e.g. 0.5312 -> 53.12
    return Number((v * 100).toFixed(4))
  }

  const onMarketTick = (tick: MarketTick, _portfolio: PortfolioSnapshot, ctx?: StrategyContext): Intent[] => {
    void _portfolio

    const nowMs = tick.snapshot.timestamp || Date.now()
    if (nowMs - lastLogAtMs < cfg.logEveryMs) return []
    lastLogAtMs = nowMs

    const vol = (ctx?.plugins?.['timeWindowVolatility'] as VolatilitySnapshot | undefined) ?? undefined

    // Render a readable table in terminal (updates in-place when TTY).
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[2J\x1b[H') // clear + home cursor
    }

    const assetIdsAll = Object.keys(tick.snapshot.byAssetId).sort()
    const assetIds = cfg.assetId ? assetIdsAll.filter((id) => id === cfg.assetId) : assetIdsAll
    if (assetIds.length === 0) return []

    for (const assetId of assetIds) {
      const byWindow = vol?.byAssetId[assetId] ?? null
      const bestAsk = tick.snapshot.byAssetId[assetId]?.bestAsk ?? null

      console.log(
        `[readVolatilityIndicator.v1] tsMs=${nowMs} asOfTsMs=${vol?.asOfTsMs ?? 'n/a'} assetId=${assetId} bestAsk=${
          bestAsk ?? 'n/a'
        }`,
      )

      if (!byWindow) {
        console.log('[readVolatilityIndicator.v1] (no volatility yet for this assetId)')
        console.log('')
        continue
      }

      const rows = Object.keys(windows).map((label) => {
        const s = byWindow[label]
        return {
          window: label,
          ready: s?.ready ?? false,
          start: fmtCents(s?.startPrice ?? null),
          end: fmtCents(s?.endPrice ?? null),
          net: fmtCents(s?.netChange ?? null),
          low: fmtCents(s?.low ?? null),
          high: fmtCents(s?.high ?? null),
          highLowRange: fmtCents(s?.highLowRange ?? null),
          stddev: fmt(s?.stddev ?? null),
          avgAbsChange: fmt(s?.avgAbsChange ?? null),
          n: s?.n ?? 0,
          coverageMs: s?.coverageMs ?? null,
          staleMs: s?.staleMs ?? null,
        }
      })

      console.table(rows)
      console.log('')
    }
    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return {
    strategy: { name, onMarketTick, onAccountEvent },
    plugins,
  }
}


