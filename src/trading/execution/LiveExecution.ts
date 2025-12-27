import { OrderType as PolyOrderType, Side as PolySide } from '@polymarket/clob-client'
import type { ClobClient } from '@polymarket/clob-client'

import type {
  AccountEvent,
  CancelAllIntent,
  CancelOrderIntent,
  PlaceLimitIntent,
} from '../../strategy/Strategy.js'
import type { PolymarketConfig } from '../../polymarket/config.js'
import { createClobClient } from '../../polymarket/clobClient.js'
import type { ExecutionAdapter, OrderManagerContext } from '../OrderManager.js'

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

  constructor(opts: LiveExecutionOptions = {}) {
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

  async placeLimit(
    intent: PlaceLimitIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    console.log('placing limit order in LiveExecution', {
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
      console.log('LiveExecution > response api >',  resp )

      const ok = (resp as { success?: unknown }).success
      if (ok === false) {
        const msg = (resp as { errorMsg?: unknown }).errorMsg
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

      const events: AccountEvent[] = [
        {
          kind: 'order_accepted',
          tsMs: nowMs,
          clientOrderId: intent.clientOrderId,
          ...(orderId ? { orderId } : {}),
        },
        {
          kind: 'order_open',
          tsMs: nowMs,
          clientOrderId: intent.clientOrderId,
          ...(orderId ? { orderId } : {}),
        },
      ]

      // Fast-path: if FOK matched, response may include orderHashes.
      // We *do not* synthesize fills here without a guaranteed fill breakdown; user WS/polling will reconcile.
      // Strategy can still treat this as accepted/open; fill will arrive via account stream quickly.
      return { events }
    } catch (err) {
      console.log('LiveExecution > error >',  err )
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
    await this.client.cancelAll().catch(() => undefined)
    return { events: [] }
  }

  async onMarketTick(ctx: OrderManagerContext): Promise<{ events: AccountEvent[] }> {
    void ctx
    // Live fills should come from user WS/polling; no synthetic fills here.
    return { events: [] }
  }
}
