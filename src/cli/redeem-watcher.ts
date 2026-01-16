import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { JsonRpcProvider, Wallet } from 'ethers'

import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import { fetchAllPositions, type Position } from '../polymarket/dataApi.js'
import { redeemViaRelayer } from '../polymarket/relayerClient.js'
import { redeemBinaryOutcomePositions } from '../blockchain/conditionalTokens.js'

type RedeemState = {
  redeemedConditionIds: string[]
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
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
  const redeemMode = (process.env.POLYMARKET_TX_MODE_REDEEM ?? 'relayer').toLowerCase()
  const eoaGasMultiplier = Number(process.env.POLYMARKET_EOA_GAS_MULTIPLIER ?? '2')
  const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com'
  const provider = new JsonRpcProvider(rpcUrl, cfg.clob.chainId, { staticNetwork: true })
  const eoaAddress = cfg.privateKey ? await new Wallet(cfg.privateKey, provider).getAddress() : null
  const safeAddress = cfg.clob.funder ?? null

  const redeemAddress = redeemMode === 'relayer' ? safeAddress : eoaAddress
  if (!redeemAddress) {
    throw new Error(
      redeemMode === 'relayer'
        ? '[redeem-watcher] missing CLOB_FUNDER (SAFE address)'
        : '[redeem-watcher] missing PRIVATE_KEY (EOA address)',
    )
  }

  const intervalMs = envInt('REDEEM_WATCH_INTERVAL_MS', 30_000)
  const statePath = process.env.REDEEM_STATE_PATH ?? 'data/redeem/redeemed.json'
  const state = await loadRedeemState(statePath)
  const redeemed = new Set(state.redeemedConditionIds)

  const formatTimestamp = (): string => {
    const now = new Date()
    return now.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const printPositionsTable = (title: string, positions: Position[]): void => {
    if (positions.length === 0) return

    const header = '  Slug                              Size    Outcome   Value'
    const separator = '  ' + '─'.repeat(56)

    console.log('')
    console.log(`  ${title}:`)
    console.log(header)
    console.log(separator)
    for (const p of positions) {
      const slug = p.slug.padEnd(32)
      const size = String(p.size).padStart(6)
      const outcome = p.outcome.padEnd(8)
      const value = `$${p.currentValue.toFixed(2)}`
      console.log(`  ${slug}  ${size}    ${outcome}  ${value}`)
    }
  }

  const tick = async (): Promise<void> => {
    // Fetch all positions in ONE API call
    const allPositions = await fetchAllPositions(redeemAddress)
    const redeemablePositions = allPositions.filter((p) => p.redeemable)
    const pendingPositions = allPositions.filter((p) => !p.redeemable)

    console.log(
      `[redeem-watcher] tick @ ${formatTimestamp()} | ${allPositions.length} positions (${redeemablePositions.length} redeemable, ${pendingPositions.length} pending)`,
    )

    printPositionsTable('Redeemable', redeemablePositions)
    printPositionsTable('Pending', pendingPositions)
    console.log('')

    const positions = redeemablePositions

    for (const pos of positions) {
      if (redeemed.has(pos.conditionId)) {
        console.log('[redeem-watcher] skipping already redeemed', {
          slug: pos.slug,
          conditionId: pos.conditionId,
        })
        continue
      }

      try {
        console.log('[redeem-watcher] redeeming', {
          slug: pos.slug,
          conditionId: pos.conditionId,
          size: pos.size,
          outcome: pos.outcome,
          currentValue: pos.currentValue,
        })

        const res =
          redeemMode === 'relayer'
            ? await redeemViaRelayer({ conditionId: pos.conditionId })
            : await redeemBinaryOutcomePositions({
                rpcUrl,
                chainId: cfg.clob.chainId,
                privateKey: cfg.privateKey as string,
                conditionId: pos.conditionId,
                gasMultiplier: eoaGasMultiplier,
              })

        console.log('[redeem-watcher] redeemed', {
          slug: pos.slug,
          conditionId: pos.conditionId,
          txHash: res.txHash,
          redeemedValue: pos.currentValue,
        })

        redeemed.add(pos.conditionId)
        state.redeemedConditionIds = Array.from(redeemed)
        await saveRedeemState(statePath, state)
      } catch (err) {
        console.warn('[redeem-watcher] error', { slug: pos.slug, conditionId: pos.conditionId, err })
      }
    }
  }

  console.log('[redeem-watcher] started', {
    intervalMs,
    redeemMode,
    redeemAddress,
    eoaGasMultiplier,
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
