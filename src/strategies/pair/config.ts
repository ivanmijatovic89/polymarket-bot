import { z } from 'zod'

export const ConfigSchema = z
  .strictObject({
    rangeStart: z.coerce.number().min(0.51).max(0.98).default(0.6),
    rangeEnd: z.coerce.number().min(0.52).max(0.99).default(0.8),
    priceStep: z.coerce.number().min(0.001).max(0.1).default(0.01),
    sizeHigh: z.coerce.number().positive().max(2000).default(24),
    sizeLow: z.coerce.number().positive().max(2000).default(4),
    sizeMultiplier: z.coerce.number().positive().max(10).default(2),
    normalSizingExponent: z.coerce.number().positive().max(10).default(1),
    maxCapital: z.coerce.number().positive().max(10000).default(800),
    minOrderSize: z.coerce.number().positive().default(5),
    minOrderNotional: z.coerce.number().nonnegative().default(1),
    orderPriceStep: z.coerce.number().min(0.001).max(0.01).default(0.01),
    retryMs: z.coerce.number().int().min(100).default(500),
    quoteLifetimeMs: z.coerce.number().int().min(100).default(2000),
    maxBookAgeMs: z.coerce.number().int().positive().default(5000),
    maxSpread: z.coerce.number().positive().max(0.5).default(0.05),
    logMode: z.enum(['fills', 'off']).default('fills'),
  })
  .superRefine((cfg, ctx) => {
    const steps = (cfg.rangeEnd - cfg.rangeStart) / cfg.priceStep
    if (steps < 1 || steps > 500 || Math.abs(steps - Math.round(steps)) > 1e-7)
      ctx.addIssue({
        code: 'custom',
        path: ['priceStep'],
        message: 'Range must contain 1–500 whole steps',
      })
    if (cfg.sizeLow > cfg.sizeHigh || cfg.sizeHigh * cfg.sizeMultiplier > 2000)
      ctx.addIssue({
        code: 'custom',
        path: ['sizeHigh'],
        message: 'Require low <= high and scaled high <= 2000 shares',
      })
    if (cfg.sizeLow * cfg.sizeMultiplier < cfg.minOrderSize)
      ctx.addIssue({
        code: 'custom',
        path: ['sizeLow'],
        message: 'Smallest allocation must meet minimum order size',
      })
  })

export type Config = z.infer<typeof ConfigSchema>
export type Outcome = 'UP' | 'DOWN'
export type Execution = 'taker' | 'maker'
export type Variant = {
  id: string
  title: string
  repairCurve: 'none' | 'immediate' | 'linear' | 'convex' | 'concave' | 'stepped'
  repairStart: number
  repairEnd: number
  normalExecution: Execution
  repairExecution: Execution
  repairChunk?: number
}

export const opposite = (side: Outcome): Outcome => (side === 'UP' ? 'DOWN' : 'UP')
export const floorShares = (size: number): number => Math.floor((size + 1e-8) * 100) / 100

export function generateLadder(cfg: Config) {
  const count = Math.round((cfg.rangeEnd - cfg.rangeStart) / cfg.priceStep)
  return Array.from({ length: count + 1 }, (_, index) => {
    const x = index / count
    const span = cfg.sizeHigh - cfg.sizeLow
    return {
      index,
      price: Number((cfg.rangeStart + index * cfg.priceStep).toFixed(6)),
      directional: floorShares(
        (cfg.sizeLow + span * (1 - x) ** cfg.normalSizingExponent) * cfg.sizeMultiplier,
      ),
      opposite: floorShares(
        (cfg.sizeLow + span * x ** cfg.normalSizingExponent) * cfg.sizeMultiplier,
      ),
    }
  })
}

export function repairFraction(depth: number, variant: Variant): number {
  if (variant.repairCurve === 'none' || depth + 1e-8 < variant.repairStart) return 0
  if (variant.repairCurve === 'immediate' || depth + 1e-8 >= variant.repairEnd) return 1
  if (variant.repairCurve === 'stepped') {
    return depth + 1e-8 >= (variant.repairStart + variant.repairEnd) / 2 ? 60 / 104 : 25 / 104
  }
  const x = Math.max(
    0,
    Math.min(1, (depth - variant.repairStart) / (variant.repairEnd - variant.repairStart)),
  )
  if (variant.repairCurve === 'convex') return x * x
  if (variant.repairCurve === 'concave') return Math.sqrt(x)
  return x
}

/** Filled repairs stay credited even after a bounce, new peak, or normal fill. */
export function repairTarget(
  normal: Record<Outcome, number>,
  repairs: Record<Outcome, number>,
  overweight: Outcome,
  fraction: number,
) {
  const missing = opposite(overweight)
  const baseline = Math.max(0, normal[overweight] - normal[missing] + repairs[overweight])
  const imbalance = Math.max(0, baseline - repairs[missing])
  const desired = baseline * fraction
  return {
    baseline,
    desired,
    actual: repairs[missing],
    additional: floorShares(Math.min(imbalance, Math.max(0, desired - repairs[missing]))),
  }
}
