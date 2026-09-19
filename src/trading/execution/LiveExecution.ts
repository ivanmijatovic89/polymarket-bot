import { OrderType as PolyOrderType, Side as PolySide } from '@polymarket/clob-client'
import type { ClobClient } from '@polymarket/clob-client'

import type {
  AccountEvent,
  CancelAllIntent,
  CancelBatchIntent,
  CancelMarketIntent,
  OrderReference,
  CancelOrderIntent,
  MergePositionsIntent,
  PlaceBatchIntent,
  PlaceLimitIntent,
  SplitPositionsIntent,
} from '../../strategy/Strategy.js'
import type { PolymarketConfig } from '../../polymarket/config.js'
import { createClobClient } from '../../polymarket/clobClient.js'
import { loadPolymarketConfigFromEnv } from '../../polymarket/config.js'
import type { ExecutionAdapter, OrderManagerContext } from '../OrderManager.js'
import {
  mergeBinaryOutcomePositions as mergeViaCtf,
  splitBinaryOutcomePositions as splitViaCtf,
} from '../../blockchain/conditionalTokens.js'
import { mergeViaRelayer, splitViaRelayer } from '../../polymarket/relayerClient.js'

import {
  cancelFailed,
  matchesCancelScope,
  resolveCancelBatch,
  validateCancelScope,
} from '../cancellation.js'

function toPolySide(side: 'BUY' | 'SELL'): PolySide {
  return side === 'BUY' ? PolySide.BUY : PolySide.SELL
}

function toPolyOrderType(t: 'FOK' | 'GTC' | 'GTD'): PolyOrderType {
  // Polymarket clob-client OrderType supports FOK/GTC/GTD/FAK; we use only these 3.
  if (t === 'FOK') return PolyOrderType.FOK
  if (t === 'GTD') return PolyOrderType.GTD
  return PolyOrderType.GTC
}

export type LiveExecutionOptions = {
  /**
   * Optional config override. If not provided, config will be loaded from environment variables.
   */
  config?: PolymarketConfig
  /**
   * Optional overrides for specific config values.
   */
  overrides?: {
    host?: string
    chainId?: number
    privateKey?: string
    creds?: PolymarketConfig['creds']
    signatureType?: number
    funder?: string
  }
  /**
   * Optional tickSize / negRisk passed to createOrder/createAndPostOrder when applicable.
   * For now we keep undefined and rely on defaults; strategy/backtest uses live book prices already.
   */
  orderCreateOptions?: { tickSize?: string; negRisk?: boolean }
  /**
   * Optional hook fired after a successful split (live only).
   */
  onSplitSuccess?: (info: { conditionId: string; txHash: string; splitShares: number }) => void
}

export class LiveExecution implements ExecutionAdapter {
  private readonly client: ClobClient
  private readonly config: PolymarketConfig
  private readonly warmedTokenIds = new Set<string>()
  private readonly onSplitSuccess?: (info: {
    conditionId: string
    txHash: string
    splitShares: number
  }) => void

  constructor(opts: LiveExecutionOptions = {}) {
    // Keep a local copy of config for non-CLOB operations (e.g. on-chain merge via privateKey).
    // createClobClient() also loads from env, but we need access to privateKey/chainId here too.
    const baseCfg = opts.config ?? loadPolymarketConfigFromEnv()
    const overrides = opts.overrides
    const cfg: PolymarketConfig = {
      ...baseCfg,
      ...(overrides?.privateKey ? { privateKey: overrides.privateKey } : {}),
      ...(overrides?.chainId ? { clob: { ...baseCfg.clob, chainId: overrides.chainId } } : {}),
    }
    this.config = cfg
    if (opts.onSplitSuccess) {
      this.onSplitSuccess = opts.onSplitSuccess
    }

    // If no config or overrides provided, createClobClient will auto-load from env vars
    if (opts.config !== undefined || opts.overrides !== undefined) {
      this.client = createClobClient({
        ...(opts.config !== undefined ? { config: opts.config } : {}),
        ...(opts.overrides !== undefined ? { overrides: opts.overrides } : {}),
      })
    } else {
      this.client = createClobClient()
    }
  }

  /**
   * Pre-warm token metadata caches inside @polymarket/clob-client for a market's tokens.
   *
   * This avoids first-order cold-start overhead where clob-client fetches per-token:
   * - tickSize
   * - negRisk
   * - feeRate
   *
   * This is intentionally *not* part of the Intent pipeline; trading-bot should call it on startup
   * and on market rotation.
   */
  async warmupMarket(args: { assetIds: string[]; slug?: string }): Promise<void> {
    const ids = Array.isArray(args.assetIds)
      ? args.assetIds.filter((x) => typeof x === 'string' && x.length > 0)
      : []
    if (ids.length === 0) return

    const toWarm = ids.filter((id) => !this.warmedTokenIds.has(id))
    for (const id of toWarm) this.warmedTokenIds.add(id)
    if (toWarm.length === 0) return

    console.log('[live-execution][warmup-market][🔥] warming tokens', {
      ...(args.slug ? { slug: args.slug } : {}),
      assetIds: toWarm,
    })

    await Promise.all(
      toWarm.map(async (tokenID) => {
        await Promise.all([
          this.client.getTickSize(tokenID).catch(() => undefined),
          this.client.getNegRisk(tokenID).catch(() => undefined),
          this.client.getFeeRateBps(tokenID).catch(() => undefined),
        ])
      }),
    )
  }

  async placeBatch(
    intent: PlaceBatchIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    console.log('[live-execution] placeBatch', {
      orderCount: intent.orders.length,
      orders: intent.orders.map((o) => ({
        clientOrderId: o.clientOrderId,
        assetId: o.assetId,
        side: o.side,
        price: o.price,
        size: o.size,
        orderType: o.orderType,
        ...(o.postOnly !== undefined ? { postOnly: o.postOnly } : {}),
      })),
    })

    if (!intent.orders || intent.orders.length === 0) {
      return { events: [] }
    }

    // Polymarket allows up to 15 orders per batch (based on common API limits)
    if (intent.orders.length > 15) {
      const events: AccountEvent[] = []
      for (const order of intent.orders) {
        events.push({
          kind: 'order_rejected',
          tsMs: nowMs,
          clientOrderId: order.clientOrderId,
          reason: 'batch_too_large(max_15_orders)',
        })
      }
      return { events }
    }

    try {
      // Create signed orders for all intents
      const batchOrders = await Promise.all(
        intent.orders.map(async (order) => {
          const signed = await this.client.createOrder({
            tokenID: order.assetId,
            price: order.price,
            size: order.size,
            side: toPolySide(order.side),
            ...(order.orderType === 'GTD' && order.expireAtMs
              ? { expiration: Math.floor(order.expireAtMs / 1000) }
              : {}),
          })
          return {
            order: signed,
            orderType: toPolyOrderType(order.orderType),
            ...(order.postOnly !== undefined ? { postOnly: order.postOnly } : {}),
          }
        }),
      )

      // Post all orders in a single batch request
      const resp = await this.client.postOrders(batchOrders)
      console.log('[live-execution][⚡️] Batch API response', resp)

      const events: AccountEvent[] = []

      // Handle response - Polymarket batch API returns array of results
      if (Array.isArray(resp)) {
        for (let i = 0; i < resp.length && i < intent.orders.length; i++) {
          const orderResult = resp[i]
          const orderIntent = intent.orders[i]
          if (!orderIntent) continue

          // Check for HTTP error
          if (orderResult && typeof orderResult === 'object' && 'error' in orderResult) {
            const errorMsg =
              typeof orderResult.error === 'string' ? orderResult.error : 'order_rejected'
            events.push({
              kind: 'order_rejected',
              tsMs: nowMs,
              clientOrderId: orderIntent.clientOrderId,
              reason: errorMsg,
            })
            continue
          }

          // Check for API-level error (success: false)
          const ok = (orderResult as { success?: unknown }).success
          if (ok === false) {
            const msg = (orderResult as { errorMsg?: unknown }).errorMsg
            events.push({
              kind: 'order_rejected',
              tsMs: nowMs,
              clientOrderId: orderIntent.clientOrderId,
              reason: typeof msg === 'string' ? msg : 'order_rejected',
            })
            continue
          }

          // Success - extract orderId
          const orderIdRaw = (orderResult as { orderId?: unknown; orderID?: unknown }).orderId
          const orderId =
            typeof orderIdRaw === 'string'
              ? orderIdRaw
              : typeof (orderResult as { orderID?: unknown }).orderID === 'string'
                ? ((orderResult as { orderID?: string }).orderID as string)
                : undefined

          events.push({
            kind: 'order_accepted',
            tsMs: nowMs,
            clientOrderId: orderIntent.clientOrderId,
            ...(orderId ? { orderId } : {}),
          })
        }

        // If response array is shorter than orders array, reject remaining orders
        if (resp.length < intent.orders.length) {
          for (let i = resp.length; i < intent.orders.length; i++) {
            const orderIntent = intent.orders[i]
            if (orderIntent) {
              events.push({
                kind: 'order_rejected',
                tsMs: nowMs,
                clientOrderId: orderIntent.clientOrderId,
                reason: 'missing_batch_response',
              })
            }
          }
        }
      } else {
        // Fallback: if response is not an array, reject all orders
        for (const order of intent.orders) {
          events.push({
            kind: 'order_rejected',
            tsMs: nowMs,
            clientOrderId: order.clientOrderId,
            reason: 'invalid_batch_response',
          })
        }
      }

      return { events }
    } catch (err) {
      console.log('[live-execution][⛔️] Batch error', err)
      const events: AccountEvent[] = []
      for (const order of intent.orders) {
        events.push({
          kind: 'order_rejected',
          tsMs: nowMs,
          clientOrderId: order.clientOrderId,
          reason: `postOrders failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
      return { events }
    }
  }

  async placeLimit(
    intent: PlaceLimitIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    console.log('[live-execution] placeLimit', {
      assetId: intent.assetId,
      price: intent.price,
      size: intent.size,
      side: intent.side,
      orderType: intent.orderType,
      ...(intent.postOnly !== undefined ? { postOnly: intent.postOnly } : {}),
    })
    try {
      const signed = await this.client.createOrder({
        tokenID: intent.assetId,
        price: intent.price,
        size: intent.size,
        side: toPolySide(intent.side),
        ...(intent.orderType === 'GTD' && intent.expireAtMs
          ? { expiration: Math.floor(intent.expireAtMs / 1000) }
          : {}),
      })

      const resp = await this.client.postOrder(
        signed,
        toPolyOrderType(intent.orderType),
        false, // Preserve the SDK's existing deferExec default.
        intent.postOnly ?? false,
      )
      // Resp shape varies; docs show {success, orderId, orderHashes, errorMsg}.
      console.log('[live-execution][⚡️] API response ', resp)

      // Check for HTTP error first (from errorHandling in http-helpers)
      if (resp && typeof resp === 'object' && 'error' in resp) {
        const errorMsg = typeof resp.error === 'string' ? resp.error : 'order_rejected'
        console.log('[live-execution][⛔️] errorMsg (HTTP error) ', errorMsg)
        return {
          events: [
            {
              kind: 'order_rejected',
              tsMs: nowMs,
              clientOrderId: intent.clientOrderId,
              reason: errorMsg,
            },
          ],
        }
      }

      // Check for API-level error (success: false)
      const ok = (resp as { success?: unknown }).success
      if (ok === false) {
        const msg = (resp as { errorMsg?: unknown }).errorMsg
        console.log('[live-execution][⛔️] errorMsg (API error) ', msg)
        return {
          events: [
            {
              kind: 'order_rejected',
              tsMs: nowMs,
              clientOrderId: intent.clientOrderId,
              reason: typeof msg === 'string' ? msg : 'order_rejected',
            },
          ],
        }
      }

      const orderIdRaw = (resp as { orderId?: unknown; orderID?: unknown }).orderId
      const orderId =
        typeof orderIdRaw === 'string'
          ? orderIdRaw
          : typeof (resp as { orderID?: unknown }).orderID === 'string'
            ? ((resp as { orderID?: string }).orderID as string)
            : undefined

      // IMPORTANT (live trading):
      // Emit ONLY `order_accepted` so we can link clientOrderId <-> orderId for later reconciliation.
      // Do NOT emit `order_open` / `order_done` here; user WS order messages reflect the actual lifecycle,
      // and emitting both causes duplicate/confusing transitions.
      return {
        events: [
          {
            kind: 'order_accepted',
            tsMs: nowMs,
            clientOrderId: intent.clientOrderId,
            ...(orderId ? { orderId } : {}),
          },
        ],
      }
    } catch (err) {
      console.log('[live-execution][⛔️] error 1234', err)
      return {
        events: [
          {
            kind: 'order_rejected',
            tsMs: nowMs,
            clientOrderId: intent.clientOrderId,
            reason: `postOrder failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }
    }
  }

  private async cancelRequest(
    intent: CancelOrderIntent | CancelBatchIntent | CancelMarketIntent | CancelAllIntent,
    ctx: OrderManagerContext,
    request: () => Promise<unknown>,
    targets?: OrderReference[],
  ): Promise<{ events: AccountEvent[] }> {
    const open = Object.values(ctx.portfolio?.openOrdersByClientId ?? {})
    const history = Object.values(ctx.portfolio?.ordersByClientId ?? {})
    const reference = (orderId: string): OrderReference => {
      const known =
        targets?.find((o) => o.orderId === orderId) ?? open.find((o) => o.orderId === orderId)
      return { orderId, ...(known?.clientOrderId ? { clientOrderId: known.clientOrderId } : {}) }
    }
    const failure = (reason: string, ref?: OrderReference): AccountEvent =>
      cancelFailed(
        intent.kind,
        ctx.nowMs,
        reason,
        ref ??
          (intent.kind === 'cancel_market'
            ? {
                ...(intent.market ? { market: intent.market } : {}),
                ...(intent.assetId ? { assetId: intent.assetId } : {}),
              }
            : {}),
      )
    const failRequest = (reason: string): { events: AccountEvent[] } => ({
      events: targets?.length ? targets.map((ref) => failure(reason, ref)) : [failure(reason)],
    })
    try {
      const response = await request()
      if (!response || typeof response !== 'object') return failRequest('invalid_cancel_response')
      const result = response as Record<string, unknown>
      if (
        result.error ||
        !Array.isArray(result.canceled) ||
        !result.canceled.every((id) => typeof id === 'string' && id.length > 0) ||
        !result.not_canceled ||
        typeof result.not_canceled !== 'object' ||
        Array.isArray(result.not_canceled)
      ) {
        return failRequest(
          typeof result.error === 'string' ? result.error : 'invalid_cancel_response',
        )
      }
      const canceled = new Set<string>(result.canceled)
      const failed = result.not_canceled as Record<string, unknown>
      const requested = targets ? new Set(targets.map((ref) => ref.orderId!)) : null
      const ids = requested ?? new Set([...canceled, ...Object.keys(failed)])
      const events: AccountEvent[] = []
      for (const orderId of ids) {
        const ref = reference(orderId)
        // Do not attach a response for another scope to a locally known order.
        const known =
          open.find((o) => o.orderId === orderId) ?? ctx.portfolio?.wsOpenOrdersByOrderId?.[orderId]
        if (
          intent.kind === 'cancel_market' &&
          known &&
          !matchesCancelScope(known, {
            ...(known.market && intent.market ? { market: intent.market } : {}),
            ...(known.assetId && intent.assetId ? { assetId: intent.assetId } : {}),
          })
        ) {
          events.push(failure('cancel_response_outside_scope', ref))
          continue
        }
        if (Object.hasOwn(failed, orderId) || !canceled.has(orderId)) {
          events.push(
            failure(
              typeof failed[orderId] === 'string' ? failed[orderId] : 'cancel_not_confirmed',
              ref,
            ),
          )
          continue
        }
        const previous = history.find((o) => o.orderId === orderId)
        if (
          !open.some((o) => o.orderId === orderId) &&
          previous?.lifecycleState &&
          ['filled', 'canceled', 'expired', 'killed', 'rejected'].includes(previous.lifecycleState)
        )
          continue
        events.push({ kind: 'order_done', tsMs: ctx.nowMs, ...ref, reason: 'canceled' })
      }
      return { events }
    } catch (error) {
      return failRequest(error instanceof Error ? error.message : String(error))
    }
  }

  async cancelBatch(
    intent: CancelBatchIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const { orders, events } = resolveCancelBatch(intent, ctx.portfolio, ctx.nowMs)
    if (orders.length === 0) return { events }
    const result = await this.cancelRequest(
      intent,
      ctx,
      () => this.client.cancelOrders(orders.map((o) => o.orderId!)),
      orders,
    )
    return { events: [...events, ...result.events] }
  }

  async cancelMarket(
    intent: CancelMarketIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const error = validateCancelScope(intent)
    if (error) return { events: [cancelFailed(intent.kind, ctx.nowMs, error)] }
    return this.cancelRequest(intent, ctx, () =>
      this.client.cancelMarketOrders({
        ...(intent.market !== undefined ? { market: intent.market } : {}),
        ...(intent.assetId !== undefined ? { asset_id: intent.assetId } : {}),
      }),
    )
  }

  async cancelOrder(
    intent: CancelOrderIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const { orders, events } = resolveCancelBatch(
      { kind: 'cancel_batch', orders: [intent] },
      ctx.portfolio,
      ctx.nowMs,
    )
    const failures = events.map((ev) =>
      ev.kind === 'cancel_failed' ? { ...ev, operation: intent.kind } : ev,
    )
    const target = orders[0]
    if (!target) return { events: failures }
    const result = await this.cancelRequest(
      intent,
      ctx,
      () => this.client.cancelOrder({ orderID: target.orderId! }),
      [target],
    )
    return { events: [...failures, ...result.events] }
  }

  async cancelAll(
    intent: CancelAllIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    return this.cancelRequest(intent, ctx, () => this.client.cancelAll())
  }

  async onMarketTick(ctx: OrderManagerContext): Promise<{ events: AccountEvent[] }> {
    void ctx
    // Live fills should come from user WS/polling; no synthetic fills here.
    return { events: [] }
  }

  async splitPositions(
    intent: SplitPositionsIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    const requested =
      typeof intent.size === 'number' && Number.isFinite(intent.size) ? intent.size : 0
    const conditionId = ctx.lastMarket?.market
    const privateKey = this.config.privateKey
    const chainId = this.config.clob?.chainId ?? 137
    const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com'

    if (!intent.assetIdA || !intent.assetIdB || intent.assetIdA === intent.assetIdB) {
      return {
        events: [
          {
            kind: 'split_failed',
            tsMs: nowMs,
            assetIdA: intent.assetIdA,
            assetIdB: intent.assetIdB,
            requestedSize: requested,
            reason: 'invalid asset ids',
          },
        ],
      }
    }

    if (!conditionId) {
      return {
        events: [
          {
            kind: 'split_failed',
            tsMs: nowMs,
            assetIdA: intent.assetIdA,
            assetIdB: intent.assetIdB,
            requestedSize: requested,
            reason: 'missing conditionId (ctx.lastMarket.market)',
          },
        ],
      }
    }

    if (!privateKey) {
      return {
        events: [
          {
            kind: 'split_failed',
            tsMs: nowMs,
            assetIdA: intent.assetIdA,
            assetIdB: intent.assetIdB,
            requestedSize: requested,
            reason: 'missing privateKey in PolymarketConfig',
          },
        ],
      }
    }

    const splitMode = (process.env.POLYMARKET_TX_MODE_SPLIT ?? 'direct').toLowerCase()
    const eoaGasMultiplier = Number(process.env.POLYMARKET_EOA_GAS_MULTIPLIER ?? '2')
    const maxRetries = Number(process.env.SPLIT_MAX_RETRY ?? '2')
    const retryDelayMs = Number(process.env.SPLIT_RETRY_DELAY_MS ?? '3000')

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log('[live-execution] splitPositions', {
          mode: splitMode,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          size: requested,
          conditionId,
          attempt,
        })

        const res =
          splitMode === 'relayer'
            ? await splitViaRelayer({ conditionId, shares: requested })
            : await splitViaCtf({
                rpcUrl,
                chainId,
                privateKey,
                conditionId,
                shares: requested,
                gasMultiplier: eoaGasMultiplier,
              })

        if (attempt > 1) {
          console.log(`[live-execution][split] ✅ Succeeded on attempt ${attempt}/${maxRetries}`)
        }

        console.log('[live-execution][split] tx ok', {
          mode: splitMode,
          txHash: res.txHash,
          splitShares: res.splitShares,
          conditionId,
        })
        try {
          this.onSplitSuccess?.({ conditionId, txHash: res.txHash, splitShares: res.splitShares })
        } catch {
          // ignore
        }

        return {
          events: [
            {
              kind: 'positions_split',
              split: {
                id: `live-split:${res.txHash}:${intent.assetIdA}:${intent.assetIdB}`,
                tsMs: nowMs,
                market: conditionId,
                assetIdA: intent.assetIdA,
                assetIdB: intent.assetIdB,
                size: res.splitShares,
                splitCost: res.splitShares,
                reason: intent.reason
                  ? `${intent.reason}; tx=${res.txHash}; mode=${splitMode}`
                  : `tx=${res.txHash}; mode=${splitMode}`,
              },
            },
          ],
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.warn(
          `[live-execution][split] ⚠️ Attempt ${attempt}/${maxRetries} failed:`,
          lastError.message,
        )

        if (attempt < maxRetries) {
          console.log(`[live-execution][split] Waiting ${retryDelayMs}ms before retry...`)
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        }
      }
    }

    console.log('[live-execution][⛔️] split failed after all retries', lastError)
    return {
      events: [
        {
          kind: 'split_failed',
          tsMs: nowMs,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          requestedSize: requested,
          reason: lastError?.message ?? 'split failed after all retries',
        },
      ],
    }
  }

  async mergePositions(
    intent: MergePositionsIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    const requested =
      typeof intent.size === 'number' && Number.isFinite(intent.size) ? intent.size : 0
    const conditionId = ctx.lastMarket?.market
    const privateKey = this.config.privateKey
    const chainId = this.config.clob?.chainId ?? 137
    const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com'

    if (!conditionId) {
      return {
        events: [
          {
            kind: 'merge_failed',
            tsMs: nowMs,
            assetIdA: intent.assetIdA,
            assetIdB: intent.assetIdB,
            requestedSize: requested,
            reason: 'missing conditionId (ctx.lastMarket.market)',
          },
        ],
      }
    }
    if (!privateKey) {
      return {
        events: [
          {
            kind: 'merge_failed',
            tsMs: nowMs,
            assetIdA: intent.assetIdA,
            assetIdB: intent.assetIdB,
            requestedSize: requested,
            reason: 'missing privateKey in PolymarketConfig',
          },
        ],
      }
    }

    const mergeMode = (process.env.POLYMARKET_TX_MODE_MERGE ?? 'direct').toLowerCase()
    const eoaGasMultiplier = Number(process.env.POLYMARKET_EOA_GAS_MULTIPLIER ?? '2')
    const maxRetries = Number(process.env.MERGE_MAX_RETRY ?? '2')
    const retryDelayMs = Number(process.env.MERGE_RETRY_DELAY_MS ?? '3000')

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log('[live-execution] mergePositions', {
          mode: mergeMode,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          size: requested,
          conditionId,
          attempt,
        })

        const res =
          mergeMode === 'relayer'
            ? await mergeViaRelayer({ conditionId, shares: requested })
            : await mergeViaCtf({
                rpcUrl,
                chainId,
                privateKey,
                conditionId,
                shares: requested,
                gasMultiplier: eoaGasMultiplier,
              })

        if (attempt > 1) {
          console.log(`[live-execution][merge] ✅ Succeeded on attempt ${attempt}/${maxRetries}`)
        }

        console.log('[live-execution][merge] tx ok', {
          mode: mergeMode,
          txHash: res.txHash,
          mergedShares: res.mergedShares,
          conditionId,
        })

        return {
          events: [
            {
              kind: 'positions_merged',
              tsMs: nowMs,
              assetIdA: intent.assetIdA,
              assetIdB: intent.assetIdB,
              size: res.mergedShares,
              reason: intent.reason
                ? `${intent.reason}; tx=${res.txHash}; mode=${mergeMode}`
                : `tx=${res.txHash}; mode=${mergeMode}`,
            },
          ],
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.warn(
          `[live-execution][merge] ⚠️ Attempt ${attempt}/${maxRetries} failed:`,
          lastError.message,
        )

        if (attempt < maxRetries) {
          console.log(`[live-execution][merge] Waiting ${retryDelayMs}ms before retry...`)
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        }
      }
    }

    console.log('[live-execution][⛔️] merge failed after all retries', lastError)
    return {
      events: [
        {
          kind: 'merge_failed',
          tsMs: nowMs,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          requestedSize: requested,
          reason: lastError?.message ?? 'merge failed after all retries',
        },
      ],
    }
  }
}
