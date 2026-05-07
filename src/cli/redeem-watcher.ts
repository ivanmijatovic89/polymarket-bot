import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { JsonRpcProvider, Wallet } from 'ethers'
import WebSocket from 'ws'

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

  const webUiHost = (process.env.WEB_UI_HOST ?? '').trim()
  const webUiPort = (process.env.WEB_UI_PORT ?? '').trim()
  const notifyWsUrl =
    webUiHost && webUiPort ? `ws://${webUiHost}:${webUiPort}/ws` : ''
  let notifyWs: WebSocket | null = null
  let notifyWsReconnectTimer: NodeJS.Timeout | null = null

  const connectNotifyWs = (): void => {
    if (!notifyWsUrl) return
    if (notifyWs) return

    const ws = new WebSocket(notifyWsUrl)
    notifyWs = ws

    ws.on('open', () => {
      console.log('[redeem-watcher] ws notify connected', { url: notifyWsUrl })
    })
    ws.on('error', (err) => {
      console.warn('[redeem-watcher] ws notify error', { err: err instanceof Error ? err.message : String(err) })
    })
    ws.on('close', () => {
      console.warn('[redeem-watcher] ws notify disconnected')
      notifyWs = null
      if (!notifyWsReconnectTimer) {
        notifyWsReconnectTimer = setTimeout(() => {
          notifyWsReconnectTimer = null
          connectNotifyWs()
        }, 3000)
      }
    })
  }

  const sendBalanceRefresh = (): void => {
    if (!notifyWs || notifyWs.readyState !== WebSocket.OPEN) return
    const msg = {
      type: 'command',
      id: `redeem:${Date.now()}:${Math.floor(Math.random() * 1e6)}`,
      command: { kind: 'refresh_balance' },
    }
    try {
      notifyWs.send(JSON.stringify(msg))
    } catch {
      // ignore
    }
  }

  connectNotifyWs()

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

  const parseMarketStartFromSlug = (slug: string): number | null => {
    const m = /-(\d{10,13})$/.exec(slug.trim())
    const epochRaw = m?.[1]
    if (!epochRaw) return null
    const raw = Number(epochRaw)
    if (!Number.isFinite(raw) || raw <= 0) return null
    return epochRaw.length === 10 ? raw * 1000 : raw
  }

  const formatStart = (startMs: number | null): string => {
    if (!startMs) return '-'
    const d = new Date(startMs)
    const parts = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
    return `${get('month')} ${get('day')} ${get('year')} ${get('hour')}:${get('minute')}`.trim()
  }

  const formatAge = (startMs: number | null, nowMs: number): string => {
    if (!startMs) return '-'
    const diffMs = Math.max(0, nowMs - startMs)
    const totalSeconds = Math.floor(diffMs / 1000)
    if (totalSeconds < 60) return `${totalSeconds}s`
    const totalMinutes = Math.floor(totalSeconds / 60)
    if (totalMinutes < 60) return `${totalMinutes}m`
    const totalHours = Math.floor(totalMinutes / 60)
    if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`
    const totalDays = Math.floor(totalHours / 24)
    if (totalDays < 7) return `${totalDays}d ${totalHours % 24}h`
    const totalWeeks = Math.floor(totalDays / 7)
    return `${totalWeeks}w ${totalDays % 7}d`
  }

  const printPositionsTable = (title: string, positions: Position[]): void => {
    if (positions.length === 0) return

    const header = '  Slug                              Size    Outcome   Value    Start               Ago'
    const separator = '  ' + '─'.repeat(82)
    const nowMs = Date.now()
    const ordered = [...positions].sort((a, b) => {
      const aStart = parseMarketStartFromSlug(a.slug) ?? -Infinity
      const bStart = parseMarketStartFromSlug(b.slug) ?? -Infinity
      return bStart - aStart
    })

    console.log('')
    console.log(`  ${title}:`)
    console.log(header)
    console.log(separator)
    for (const p of ordered) {
      const slug = p.slug.padEnd(32)
      const size = String(p.size).padStart(6)
      const outcome = p.outcome.padEnd(8)
      const value = `$${p.currentValue.toFixed(2)}`
      const startMs = parseMarketStartFromSlug(p.slug)
      const start = formatStart(startMs).padEnd(18)
      const ago = formatAge(startMs, nowMs).padEnd(9)
      console.log(`  ${slug}  ${size}    ${outcome}  ${value.padEnd(7)}  ${start}  ${ago}`)
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

        sendBalanceRefresh()

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
