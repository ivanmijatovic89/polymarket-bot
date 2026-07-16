import type { Hex } from 'viem'

export type RpcLog = {
  address: Hex
  topics: Hex[]
  data: Hex
  blockNumber: Hex
  transactionHash: Hex
  transactionIndex: Hex
  blockHash: Hex
  logIndex: Hex
  removed: boolean
}

export type RpcReceipt = {
  type: Hex
  status?: Hex
  root?: Hex
  cumulativeGasUsed: Hex
  logsBloom: Hex
  logs: RpcLog[]
  transactionHash: Hex
  transactionIndex: Hex
  blockHash: Hex
  blockNumber: Hex
}

export type RpcBlock = {
  number: Hex
  hash: Hex
  parentHash: Hex
  timestamp: Hex
  logsBloom: Hex
  receiptsRoot: Hex
  transactions: Hex[]
}

export type RpcMetrics = {
  httpRequests: number
  rpcCalls: number
  retries: number
  responseBytes: number
  startedAtMs: number
}
