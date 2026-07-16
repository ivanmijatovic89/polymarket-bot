import type { Hex } from 'viem'
import type { RpcBlock, RpcLog, RpcMetrics, RpcReceipt } from './types.js'

type RpcResponse<T> = {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

export type RpcClientOptions = {
  url: string
  timeoutMs?: number
  maxAttempts?: number
}

class RetryableRpcError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
  }
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recordFailure(metrics: RpcMetrics, error: unknown): void {
  const message = messageOf(error)
  metrics.lastFailure = message.slice(0, 300)
  if (/HTTP 429|rate.?limit|too many requests/i.test(message)) metrics.rateLimits += 1
  else if (error instanceof Error && error.name === 'AbortError') metrics.timeouts += 1
  else if (/HTTP 5\d\d/.test(message)) metrics.serverErrors += 1
  else if (/HTTP 4\d\d/.test(message)) metrics.clientErrors += 1
  else if (/ RPC -?\d+:/.test(message)) metrics.rpcErrors += 1
  else metrics.networkErrors += 1
}

export function isRetryableRpcFailure(error: unknown): boolean {
  const message = messageOf(error)
  if (/HTTP 4\d\d/.test(message) && !/HTTP (?:408|429)/.test(message)) return false
  if (/ RPC -3260[012]:/.test(message)) return false
  return true
}

export function isRetryableRpcHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export class ChainRpcClient {
  readonly metrics: RpcMetrics = {
    httpRequests: 0,
    rpcCalls: 0,
    retries: 0,
    rateLimits: 0,
    timeouts: 0,
    serverErrors: 0,
    rpcErrors: 0,
    networkErrors: 0,
    clientErrors: 0,
    lastFailure: null,
    responseBytes: 0,
    startedAtMs: Date.now(),
  }

  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private nextId = 1

  constructor(private readonly options: RpcClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxAttempts = options.maxAttempts ?? 5
  }

  async request<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        this.metrics.httpRequests += 1
        this.metrics.rpcCalls += 1
        const response = await fetch(this.options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
          signal: controller.signal,
        })
        const body = await response.text()
        this.metrics.responseBytes += Buffer.byteLength(body)
        if (isRetryableRpcHttpStatus(response.status)) {
          throw new RetryableRpcError(`${method} HTTP ${response.status}`, retryAfterMs(response))
        }
        if (!response.ok)
          throw new Error(`${method} HTTP ${response.status}: ${body.slice(0, 200)}`)
        const parsed = JSON.parse(body) as RpcResponse<T>
        if (parsed.error) {
          throw new Error(`${method} RPC ${parsed.error.code}: ${parsed.error.message}`)
        }
        if (parsed.result === undefined) throw new Error(`${method} returned no result`)
        return parsed.result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        recordFailure(this.metrics, error)
        if (attempt === this.maxAttempts || !isRetryableRpcFailure(error)) break
        this.metrics.retries += 1
        const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1))
        const delay = error instanceof RetryableRpcError ? (error.retryAfterMs ?? backoff) : backoff
        await new Promise((resolve) => setTimeout(resolve, delay))
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? new Error(`${method} failed`)
  }

  async batch<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    if (calls.length === 0) return []
    const requests = calls.map((call) => ({
      jsonrpc: '2.0' as const,
      id: this.nextId++,
      method: call.method,
      params: call.params,
    }))
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        this.metrics.httpRequests += 1
        this.metrics.rpcCalls += calls.length
        const response = await fetch(this.options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requests),
          signal: controller.signal,
        })
        const body = await response.text()
        this.metrics.responseBytes += Buffer.byteLength(body)
        if (isRetryableRpcHttpStatus(response.status)) {
          throw new RetryableRpcError(`batch HTTP ${response.status}`, retryAfterMs(response))
        }
        if (!response.ok) throw new Error(`batch HTTP ${response.status}: ${body.slice(0, 200)}`)
        const parsed = JSON.parse(body) as Array<RpcResponse<T>>
        const byId = new Map(parsed.map((item) => [item.id, item]))
        return requests.map((request) => {
          const item = byId.get(request.id)
          if (!item) throw new Error(`batch response missing id ${request.id}`)
          if (item.error)
            throw new Error(`${request.method} RPC ${item.error.code}: ${item.error.message}`)
          if (item.result === undefined) throw new Error(`${request.method} returned no result`)
          return item.result
        })
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        recordFailure(this.metrics, error)
        if (attempt === this.maxAttempts || !isRetryableRpcFailure(error)) break
        this.metrics.retries += 1
        const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1))
        const delay = error instanceof RetryableRpcError ? (error.retryAfterMs ?? backoff) : backoff
        await new Promise((resolve) => setTimeout(resolve, delay))
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? new Error('batch failed')
  }

  block(blockNumber: bigint): Promise<RpcBlock> {
    return this.request('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false])
  }

  blocks(blockNumbers: bigint[]): Promise<RpcBlock[]> {
    return this.batch(
      blockNumbers.map((blockNumber) => ({
        method: 'eth_getBlockByNumber',
        params: [`0x${blockNumber.toString(16)}`, false],
      })),
    )
  }

  blockNumber(): Promise<bigint> {
    return this.request<Hex>('eth_blockNumber', []).then(BigInt)
  }

  receipt(txHash: Hex): Promise<RpcReceipt> {
    return this.request('eth_getTransactionReceipt', [txHash])
  }

  receipts(txHashes: Hex[]): Promise<RpcReceipt[]> {
    return this.batch(
      txHashes.map((txHash) => ({ method: 'eth_getTransactionReceipt', params: [txHash] })),
    )
  }

  blockReceipts(blockNumber: bigint): Promise<RpcReceipt[]> {
    return this.request('eth_getBlockReceipts', [`0x${blockNumber.toString(16)}`])
  }

  logs(filter: {
    fromBlock: bigint
    toBlock: bigint
    addresses: Hex[]
    topic0?: Hex[]
    topics?: Array<Hex | Hex[] | null>
  }): Promise<RpcLog[]> {
    const topics = filter.topics ?? (filter.topic0 ? [filter.topic0] : undefined)
    return this.request('eth_getLogs', [
      {
        fromBlock: `0x${filter.fromBlock.toString(16)}`,
        toBlock: `0x${filter.toBlock.toString(16)}`,
        address: filter.addresses,
        ...(topics ? { topics } : {}),
      },
    ])
  }
}
