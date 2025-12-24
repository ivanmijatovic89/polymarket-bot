import type { Strategy } from '../strategy/Strategy.js'
import { createExampleMakerQuoteStrategy } from './exampleMakerQuote.js'
import { createExampleTakerFlipStrategy } from './exampleTakerFlip.js'
import { createHybridProductionStrategy } from './hybridProduction.js'
import { createHybridProduction2Strategy } from './hybridProduction2.js'
import { createWinnerLimitStrategy } from './winnerLimit.js'

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

  if (name === 'hybrid_production') {
    const capital = Number(
      process.env.STRAT_CAPITAL ?? process.env.HYBRID_PRODUCTION_BOT_CAPITAL ?? '10',
    )
    const debug =
      (process.env.STRAT_DEBUG ?? process.env.HYBRID_PROD_DEBUG ?? 'false').toLowerCase() === 'true'

    const a = process.env.STRAT_ASSET_ID_A
    const b = process.env.STRAT_ASSET_ID_B
    const assetIds = a && b ? ([a, b] as [string, string]) : undefined

    return createHybridProductionStrategy({
      capital: Number.isFinite(capital) ? capital : 10,
      ...(assetIds ? { assetIds } : {}),
      ...(debug ? { debug } : {}),
    })
  }

  if (name === 'hybrid_production2') {
    const capital = Number(process.env.STRAT_CAPITAL ?? '10')
    const debug = (process.env.STRAT_DEBUG ?? 'false').toLowerCase() === 'true'

    const a = process.env.STRAT_ASSET_ID_A
    const b = process.env.STRAT_ASSET_ID_B
    const assetIds = a && b ? ([a, b] as [string, string]) : undefined

    const minLockedProfitPerShare = Number(process.env.STRAT_MIN_LOCKED_PROFIT_PER_SHARE ?? '0.01')
    const costBuffer = Number(process.env.STRAT_COST_BUFFER ?? '1.02')
    const maxSingleTradePct = Number(process.env.STRAT_MAX_SINGLE_TRADE_PCT ?? '0.3')
    const minTradeValue = Number(process.env.STRAT_MIN_TRADE_VALUE ?? '0.5')
    const minPairSize = Number(process.env.STRAT_MIN_PAIR_SIZE ?? '2')
    const maxPairSize = Number(process.env.STRAT_MAX_PAIR_SIZE ?? '10')
    const minSecondsLeftToEnter = Number(process.env.STRAT_MIN_SECONDS_LEFT_TO_ENTER ?? '5')
    const maxUnhedgedHoldMs = Number(process.env.STRAT_MAX_UNHEDGED_HOLD_MS ?? '2500')

    return createHybridProduction2Strategy({
      capital: Number.isFinite(capital) ? capital : 10,
      ...(assetIds ? { assetIds } : {}),
      ...(debug ? { debug } : {}),
      ...(Number.isFinite(minLockedProfitPerShare) ? { minLockedProfitPerShare } : {}),
      ...(Number.isFinite(costBuffer) ? { costBuffer } : {}),
      ...(Number.isFinite(maxSingleTradePct) ? { maxSingleTradePct } : {}),
      ...(Number.isFinite(minTradeValue) ? { minTradeValue } : {}),
      ...(Number.isFinite(minPairSize) ? { minPairSize } : {}),
      ...(Number.isFinite(maxPairSize) ? { maxPairSize } : {}),
      ...(Number.isFinite(minSecondsLeftToEnter) ? { minSecondsLeftToEnter } : {}),
      ...(Number.isFinite(maxUnhedgedHoldMs) ? { maxUnhedgedHoldMs } : {}),
    })
  }

  if (name === 'winnerLimit') {
    const size = Number(process.env.STRAT_SIZE ?? '5')
    const triggerPrice = Number(process.env.STRAT_TRIGGER_PRICE ?? '0.9')
    const limitPriceRaw = process.env.STRAT_LIMIT_PRICE
    const limitPrice = limitPriceRaw !== undefined ? Number(limitPriceRaw) : undefined
    const minDelayMs = Number(process.env.STRAT_MIN_DELAY_MS ?? '600000')
    const debug = (process.env.STRAT_DEBUG ?? 'false').toLowerCase() === 'true'

    const a = process.env.STRAT_ASSET_ID_A
    const b = process.env.STRAT_ASSET_ID_B
    const assetIds = a && b ? ([a, b] as [string, string]) : undefined

    return createWinnerLimitStrategy({
      ...(assetIds ? { assetIds } : {}),
      size: Number.isFinite(size) ? size : 5,
      triggerPrice: Number.isFinite(triggerPrice) ? triggerPrice : 0.9,
      ...(limitPrice !== undefined && Number.isFinite(limitPrice) ? { limitPrice } : {}),
      minDelayMs: Number.isFinite(minDelayMs) ? minDelayMs : 600000,
      ...(debug ? { debug } : {}),
    })
  }

  throw new Error(`[strategy] unknown STRATEGY=${JSON.stringify(name)}`)
}
