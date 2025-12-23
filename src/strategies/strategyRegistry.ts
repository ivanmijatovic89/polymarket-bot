import type { Strategy } from '../strategy/Strategy.js'
import { createExampleMakerQuoteStrategy } from './exampleMakerQuote.js'
import { createExampleTakerFlipStrategy } from './exampleTakerFlip.js'

export function loadStrategyFromEnv(): Strategy {
  const name = (process.env.STRATEGY ?? 'example_maker_quote').trim()
  if (name === 'example_maker_quote') {
    const size = Number(process.env.STRAT_SIZE ?? '5')
    const improveBy = Number(process.env.STRAT_IMPROVE_BY ?? '0.001')
    const maxSpread = Number(process.env.STRAT_MAX_SPREAD ?? '0.05')
    const assetId = process.env.STRAT_ASSET_ID
    const orderType = (process.env.STRAT_ORDER_TYPE ?? 'GTC') as 'GTC' | 'GTD'
    const gtdTtlMs = Number(process.env.STRAT_GTD_TTL_MS ?? '120000')
    return createExampleMakerQuoteStrategy({
      ...(assetId ? { assetId } : {}),
      size: Number.isFinite(size) ? size : 5,
      improveBy: Number.isFinite(improveBy) ? improveBy : 0.001,
      maxSpread: Number.isFinite(maxSpread) ? maxSpread : 0.05,
      orderType,
      gtdTtlMs: Number.isFinite(gtdTtlMs) ? gtdTtlMs : 120000,
    })
  }

  if (name === 'example_taker_flip') {
    const size = Number(process.env.STRAT_SIZE ?? '5')
    const maxSpread = Number(process.env.STRAT_MAX_SPREAD ?? '0.02')
    const cooldownMs = Number(process.env.STRAT_COOLDOWN_MS ?? '5000')
    const assetId = process.env.STRAT_ASSET_ID
    return createExampleTakerFlipStrategy({
      ...(assetId ? { assetId } : {}),
      size: Number.isFinite(size) ? size : 5,
      maxSpread: Number.isFinite(maxSpread) ? maxSpread : 0.02,
      cooldownMs: Number.isFinite(cooldownMs) ? cooldownMs : 5000,
    })
  }

  throw new Error(`[strategy] unknown STRATEGY=${JSON.stringify(name)}`)
}
