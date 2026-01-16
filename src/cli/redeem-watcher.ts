import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Contract, JsonRpcProvider, formatUnits } from 'ethers'

import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import { fetchGammaMarketBySlug, mapApiResponseToMarket } from '../polymarket/gamma.js'
import { buildGammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import { redeemViaRelayer } from '../polymarket/relayerClient.js'
import { CONDITIONAL_TOKENS_ADDRESS } from '../polymarket/contractAddresses.js'
import { buildUpDown15mSlug, FIFTEEN_MIN_MS, floorTo15mUtc } from '../utils/timeWindows.js'

const ALL_SYMBOLS = ['btc', 'eth', 'sol', 'xrp'] as const
type Symbol = (typeof ALL_SYMBOLS)[number]

function getSymbolsFromEnv(): Symbol[] {
  const raw = process.env.REDEEM_SYMBOL?.toLowerCase().trim()
  if (!raw) return [...ALL_SYMBOLS]
  if (ALL_SYMBOLS.includes(raw as Symbol)) return [raw as Symbol]
  console.warn(`[redeem-watcher] unknown REDEEM_SYMBOL="${raw}", using all symbols`)
  return [...ALL_SYMBOLS]
}

const SYMBOLS = getSymbolsFromEnv()

const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
] as const

type RedeemState = {
  redeemedConditionIds: string[]
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function buildLookbackSlugs(hours: number): { slug: string; symbol: string }[] {
  const now = new Date()
  const end = floorTo15mUtc(now)
  const totalWindows = Math.ceil((hours * 60) / 15)
  const out: { slug: string; symbol: string }[] = []
  for (let i = 0; i <= totalWindows; i += 1) {
    const dt = new Date(end.getTime() - i * FIFTEEN_MIN_MS)
    for (const sym of SYMBOLS) {
      out.push({ slug: buildUpDown15mSlug(sym, dt), symbol: sym })
    }
  }
  return out
}

async function loadRedeemState(filePath: string): Promise<RedeemState> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as RedeemState
    if (parsed && Array.isArray(parsed.redeemedConditionIds)) return parsed
  } catch {
    // ignore
  }
  return { redeemedConditionIds: [] }
}

async function saveRedeemState(filePath: string, state: RedeemState): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2))
}

async function main(): Promise<void> {
  const cfg = loadPolymarketConfigFromEnv()
  const safeAddress = cfg.clob.funder
  if (!safeAddress) {
    throw new Error('[redeem-watcher] missing CLOB_FUNDER (SAFE address)')
  }

  const intervalMs = envInt('REDEEM_WATCH_INTERVAL_MS', 30_000)
  const lookbackHours = envInt('REDEEM_LOOKBACK_HOURS', 48)
  const batchSize = envInt('REDEEM_MAX_MARKETS_PER_TICK', 20)
  const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com'

  const symbolSuffix = SYMBOLS.length === 1 ? `-${SYMBOLS[0]}` : ''
  const defaultStatePath = `data/redeem/redeemed${symbolSuffix}.json`
  const statePath = process.env.REDEEM_STATE_PATH ?? defaultStatePath
  const state = await loadRedeemState(statePath)
  const redeemed = new Set(state.redeemedConditionIds)

  const provider = new JsonRpcProvider(rpcUrl, cfg.clob.chainId, { staticNetwork: true })
  const ctf = new Contract(CONDITIONAL_TOKENS_ADDRESS, ERC1155_ABI, provider)

  let cursor = 0

  const tick = async (): Promise<void> => {
    const slugs = buildLookbackSlugs(lookbackHours)
    if (slugs.length === 0) return

    console.log('[redeem-watcher] tick', {
      timestamp: new Date().toISOString(),
      totalSlugs: slugs.length,
      cursor,
    })

    const startIdx = cursor % slugs.length
    const batch: { slug: string; symbol: string }[] = []
    for (let i = 0; i < Math.min(batchSize, slugs.length); i += 1) {
      const idx = (startIdx + i) % slugs.length
      batch.push(slugs[idx]!)
    }
    cursor = (startIdx + batch.length) % slugs.length

    for (const item of batch) {
      try {
        const raw = await fetchGammaMarketBySlug({ slug: item.slug })
        if (!raw) continue

        const meta = buildGammaMarketMeta(raw, item.slug)
        if (!meta || meta.clobTokenIds.length < 2) continue

        const mapped = mapApiResponseToMarket(raw, item.slug, '', item.symbol.toUpperCase())
        const conditionId = mapped?.conditionId ?? (typeof raw.conditionId === 'string' ? raw.conditionId : null)
        if (!conditionId) continue
        if (redeemed.has(conditionId)) continue

        const resolvedOutcome = mapped?.resolvedOutcome
        if (!resolvedOutcome) continue

        const tokenIdA = meta.clobTokenIds[0]
        const tokenIdB = meta.clobTokenIds[1]
        if (!tokenIdA || !tokenIdB) continue

        const balA = await ctf.balanceOf(safeAddress, BigInt(tokenIdA))
        const balB = await ctf.balanceOf(safeAddress, BigInt(tokenIdB))
        if (balA === 0n && balB === 0n) continue

        const resolvedKey = resolvedOutcome.toLowerCase()
        const winningTokenId = meta.outcomeTokenMap?.[resolvedKey]
        const winningBalance =
          winningTokenId === tokenIdA ? balA : winningTokenId === tokenIdB ? balB : 0n

        console.log('[redeem-watcher] redeeming', {
          slug: item.slug,
          conditionId,
          balances: { tokenA: balA.toString(), tokenB: balB.toString() },
        })

        const res = await redeemViaRelayer({ conditionId })
        const redeemedUsdc = formatUnits(winningBalance, 6)
        console.log('[redeem-watcher] redeemed', {
          conditionId,
          txHash: res.txHash,
          redeemedUsdc,
        })
        redeemed.add(conditionId)
        state.redeemedConditionIds = Array.from(redeemed)
        await saveRedeemState(statePath, state)
      } catch (err) {
        console.warn('[redeem-watcher] error', { slug: item.slug, err })
      }
    }
  }

  console.log('[redeem-watcher] started', {
    symbols: SYMBOLS,
    intervalMs,
    lookbackHours,
    batchSize,
    safeAddress,
    statePath,
  })

  const runLoop = async (): Promise<void> => {
    try {
      await tick()
    } catch (err) {
      console.error('[redeem-watcher] tick error', err)
    }
    setTimeout(() => void runLoop(), intervalMs)
  }

  await runLoop()
}

main().catch((err) => {
  console.error('[redeem-watcher] fatal', err)
  process.exit(1)
})
