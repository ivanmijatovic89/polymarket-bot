import { OrderType as PolyOrderType, Side as PolySide } from '@polymarket/clob-client'
import type { ClobClient } from '@polymarket/clob-client'

import type {
  AccountEvent,
  CancelAllIntent,
  CancelOrderIntent,
  MergePositionsIntent,
  PlaceBatchIntent,
  PlaceLimitIntent,
} from '../../strategy/Strategy.js'
import type { PolymarketConfig } from '../../polymarket/config.js'
import { createClobClient } from '../../polymarket/clobClient.js'
import { loadPolymarketConfigFromEnv } from '../../polymarket/config.js'
import type { ExecutionAdapter, OrderManagerContext } from '../OrderManager.js'
import { mergeBinaryOutcomePositions } from '../../blockchain/conditionalTokens.js'

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
}

export class LiveExecution implements ExecutionAdapter {
  private readonly client: ClobClient
  private readonly config: PolymarketConfig

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
            const errorMsg = typeof orderResult.error === 'string' ? orderResult.error : 'order_rejected'
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

      const resp = await this.client.postOrder(signed, toPolyOrderType(intent.orderType))
      // Resp shape varies; docs show {success, orderId, orderHashes, errorMsg}.
      console.log('[live-execution][⚡️] API response ',  resp )

      // Check for HTTP error first (from errorHandling in http-helpers)
      if (resp && typeof resp === 'object' && 'error' in resp) {
        const errorMsg = typeof resp.error === 'string' ? resp.error : 'order_rejected'
        console.log('[live-execution][⛔️] errorMsg (HTTP error) ',  errorMsg )
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
        console.log('[live-execution][⛔️] errorMsg (API error) ',  msg )
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
      console.log('[live-execution][⛔️] error 1234',  err )
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

  async cancelOrder(
    intent: CancelOrderIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    console.log('[live-execution] cancelOrder', {
      orderId: intent.orderId,
      clientOrderId: intent.clientOrderId,
    })
    if (intent.orderId) {
      await this.client.cancelOrder({ orderID: intent.orderId }).catch(() => undefined)
      return {
        events: intent.clientOrderId
          ? [
              {
                kind: 'order_done',
                tsMs: nowMs,
                clientOrderId: intent.clientOrderId,
                orderId: intent.orderId,
                reason: 'canceled',
              },
            ]
          : [],
      }
    }
    if (intent.clientOrderId) {
      // Without orderId we can't cancel directly; rely on OrderManager + Portfolio mapping in future.
      return { events: [] }
    }
    return { events: [] }
  }

  async cancelAll(
    intent: CancelAllIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    void intent
    void ctx
    console.log('[live-execution] cancelAll')
    await this.client.cancelAll().catch(() => undefined)
    return { events: [] }
  }

  async onMarketTick(ctx: OrderManagerContext): Promise<{ events: AccountEvent[] }> {
    void ctx
    // Live fills should come from user WS/polling; no synthetic fills here.
    return { events: [] }
  }

  async mergePositions(
    intent: MergePositionsIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    console.log('[live-execution] mergePositions');
    const nowMs = ctx.nowMs
    const requested = typeof intent.size === 'number' && Number.isFinite(intent.size) ? intent.size : 0
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

    try {
      const res = await mergeBinaryOutcomePositions({
        rpcUrl,
        chainId,
        privateKey,
        conditionId,
        shares: requested,
      })
      return {
        events: [
          {
            kind: 'positions_merged',
            tsMs: nowMs,
            assetIdA: intent.assetIdA,
            assetIdB: intent.assetIdB,
            size: res.mergedShares,
            reason: intent.reason ? `${intent.reason}; tx=${res.txHash}` : `tx=${res.txHash}`,
          },
        ],
      }
    } catch (err) {
      return {
        events: [
          {
            kind: 'merge_failed',
            tsMs: nowMs,
            assetIdA: intent.assetIdA,
            assetIdB: intent.assetIdB,
            requestedSize: requested,
            reason: err instanceof Error ? err.message : String(err),
          },
        ],
      }
    }
  }
}
