import { ClobClient, OrderType as PolyOrderType, Side as PolySide } from '@polymarket/clob-client'
import { Wallet } from 'ethers'

import type {
  AccountEvent,
  CancelAllIntent,
  CancelOrderIntent,
  PlaceLimitIntent,
} from '../../strategy/Strategy.js'
import type { ExecutionAdapter, OrderManagerContext } from '../OrderManager.js'

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : undefined
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = env(name)
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

type ApiCreds = { apiKey: string; secret: string; passphrase: string }

function parseApiCreds(): ApiCreds {
  // Prefer existing envs you already use for WS subscribe payload.
  const apiKey = env('POLYMARKET_API_KEY') ?? env('CLOB_API_KEY')
  const secret = env('POLYMARKET_API_SECRET') ?? env('CLOB_SECRET')
  const passphrase = env('POLYMARKET_API_PASSPHRASE') ?? env('CLOB_PASS_PHRASE')
  if (!apiKey || !secret || !passphrase) {
    throw new Error(
      '[liveExecution] missing API creds (need POLYMARKET_API_KEY/POLYMARKET_API_SECRET/POLYMARKET_API_PASSPHRASE or CLOB_* equivalents)',
    )
  }
  return { apiKey, secret, passphrase }
}

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
   * Default: https://clob.polymarket.com
   */
  host?: string
  /**
   * Default: 137 (Polygon mainnet)
   */
  chainId?: number
  /**
   * Wallet private key for signing orders. Defaults to PRIVATE_KEY then POLYMARKET_PRIVATE_KEY.
   */
  privateKey?: string
  /**
   * Signature type (see Polymarket docs). Default 0 (EOA).
   */
  signatureType?: number
  /**
   * Optional funder address (required for some wallet types like Safe/proxy).
   */
  funder?: string
  /**
   * Optional tickSize / negRisk passed to createOrder/createAndPostOrder when applicable.
   * For now we keep undefined and rely on defaults; strategy/backtest uses live book prices already.
   */
  orderCreateOptions?: { tickSize?: string; negRisk?: boolean }
}

export class LiveExecution implements ExecutionAdapter {
  private readonly client: ClobClient

  constructor(opts?: LiveExecutionOptions) {
    const host = opts?.host ?? env('CLOB_API_URL') ?? 'https://clob.polymarket.com'
    const chainId = opts?.chainId ?? parseIntEnv('CLOB_CHAIN_ID', 137)
    const pk = opts?.privateKey ?? env('PRIVATE_KEY') ?? env('POLYMARKET_PRIVATE_KEY')
    if (!pk) {
      throw new Error('[liveExecution] missing PRIVATE_KEY (or POLYMARKET_PRIVATE_KEY)')
    }
    const wallet = new Wallet(pk)

    const creds = parseApiCreds()
    const signatureType = opts?.signatureType ?? parseIntEnv('CLOB_SIGNATURE_TYPE', 0)
    const funder = opts?.funder ?? env('CLOB_FUNDER')

    // clob-client constructor supports (host, chainId, signer, creds, signatureType, funder?)
    // We keep this explicit to match docs and avoid surprises.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client = new (ClobClient as any)(host, chainId, wallet, creds, signatureType, funder)
  }

  async placeLimit(
    intent: PlaceLimitIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    void ctx
    const nowMs = Date.now()
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
    void ctx
    const nowMs = Date.now()
    if (intent.orderId) {
      await this.client.cancelOrder(intent.orderId).catch(() => undefined)
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
