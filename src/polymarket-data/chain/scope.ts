import { sql } from 'drizzle-orm'
import type { Hex } from 'viem'
import { getDb } from '../../db/index.js'
import type { Timeframe } from '../marketSeries.js'
import type { TokenMarket } from './discovery.js'

export type ChainScopeMarket = {
  id: number
  conditionId: Hex
  slug: string
  symbol: string
  timeframe: Timeframe
  marketStartMs: number
  marketEndMs: number
  createdAtMs: number
  volumeGamma: string | null
  tokens: [TokenMarket, TokenMarket]
}

export type ChainMarketScope = {
  symbol: string
  timeframe: Timeframe
  fromMs: number
  toMs: number
  scanFromMs: number
  scanToMs: number
  markets: ChainScopeMarket[]
  tokens: TokenMarket[]
}

type MarketRow = {
  id: number | string
  condition_id: string
  slug: string
  symbol: string
  timeframe: Timeframe
  market_start_ms: number | string
  market_end_ms: number | string
  volume_gamma: string | null
  asset_id_0: string | null
  asset_id_1: string | null
  raw_json: Record<string, unknown> | string | null
}

function rawObject(value: MarketRow['raw_json']): Record<string, unknown> {
  if (typeof value !== 'string') return value ?? {}
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed as Record<string, unknown>
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

function validateHex32(value: string, label: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is not bytes32: ${value}`)
  return value.toLowerCase() as Hex
}

function toMarket(row: MarketRow): ChainScopeMarket {
  const id = Number(row.id)
  const marketStartMs = Number(row.market_start_ms)
  const marketEndMs = Number(row.market_end_ms)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`invalid market id ${row.id}`)
  if (!Number.isSafeInteger(marketStartMs) || !Number.isSafeInteger(marketEndMs)) {
    throw new Error(`${row.slug}: invalid market timestamps`)
  }
  if (!row.asset_id_0 || !/^\d+$/.test(row.asset_id_0)) {
    throw new Error(`${row.slug}: missing outcome token 0`)
  }
  if (!row.asset_id_1 || !/^\d+$/.test(row.asset_id_1)) {
    throw new Error(`${row.slug}: missing outcome token 1`)
  }
  const conditionId = validateHex32(row.condition_id, `${row.slug} conditionId`)
  const raw = rawObject(row.raw_json)
  const createdAtMs =
    timestamp(raw.acceptingOrdersTimestamp) ??
    timestamp(raw.startDate) ??
    timestamp(raw.createdAt) ??
    marketStartMs - 2 * 24 * 60 * 60_000
  const base = {
    marketId: id,
    conditionId,
  }
  return {
    id,
    conditionId,
    slug: row.slug,
    symbol: row.symbol,
    timeframe: row.timeframe,
    marketStartMs,
    marketEndMs,
    createdAtMs,
    volumeGamma: row.volume_gamma,
    tokens: [
      { ...base, tokenId: row.asset_id_0, outcomeIndex: 0 },
      { ...base, tokenId: row.asset_id_1, outcomeIndex: 1 },
    ],
  }
}

export async function loadChainMarketScope(input: {
  symbol: string
  timeframe: Timeframe
  fromMs: number
  toMs: number
}): Promise<ChainMarketScope> {
  if (!/^[a-z0-9]+$/.test(input.symbol)) throw new Error(`invalid symbol ${input.symbol}`)
  if (
    !Number.isSafeInteger(input.fromMs) ||
    !Number.isSafeInteger(input.toMs) ||
    input.toMs <= input.fromMs
  ) {
    throw new Error('scope requires a valid half-open time range')
  }
  const result = await getDb().execute(
    sql`SELECT id, condition_id, slug, symbol, timeframe, market_start_ms, market_end_ms,
               volume_gamma, asset_id_0, asset_id_1, raw_json
        FROM polymarket_markets
        WHERE symbol = ${input.symbol} AND timeframe = ${input.timeframe}
          AND market_start_ms >= ${input.fromMs} AND market_start_ms < ${input.toMs}
        ORDER BY market_start_ms, id`,
  )
  const rows = ((result as unknown as MarketRow[][])[0] ?? []).map(toMarket)
  if (rows.length === 0) {
    throw new Error(
      `no catalog markets for ${input.symbol}/${input.timeframe} in ` +
        `${new Date(input.fromMs).toISOString()}..${new Date(input.toMs).toISOString()}`,
    )
  }
  const tokens = rows.flatMap((market) => market.tokens)
  if (new Set(tokens.map((token) => token.tokenId)).size !== tokens.length) {
    throw new Error('market scope contains duplicate token IDs')
  }
  const tenMinutes = 10 * 60_000
  const oneHour = 60 * 60_000
  return {
    ...input,
    scanFromMs: Math.min(...rows.map((market) => market.createdAtMs)) - tenMinutes,
    scanToMs: Math.max(...rows.map((market) => market.marketEndMs)) + oneHour,
    markets: rows,
    tokens,
  }
}
