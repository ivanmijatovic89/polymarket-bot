import { BuilderConfig } from '@polymarket/builder-signing-sdk'
import {
  RelayClient,
  RelayerTxType,
  type Transaction,
} from '@polymarket/builder-relayer-client'
import { createWalletClient, encodeFunctionData, http, parseUnits, zeroHash } from 'viem'
import { polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

import { loadPolymarketConfigFromEnv } from './config.js'
import {
  CONDITIONAL_TOKENS_ADDRESS,
  USDC_ADDRESS,
  getContractAddresses,
} from './contractAddresses.js'

const DEFAULT_RELAYER_URL = 'https://relayer-v2.polymarket.com/'

type RelayerEnv = {
  relayerUrl: string
  chainId: number
  txType: RelayerTxType
  privateKey: string
  apiKey: string
  apiSecret: string
  apiPassphrase: string
}

type SplitViaRelayerArgs = {
  conditionId: string
  shares: number
}

type ApproveViaRelayerArgs = {
  clobHost: string
  chainId: number
}

type WithdrawUsdcViaRelayerArgs = {
  to: string
  amount: number
}

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const ERC1155_ABI = [
  {
    name: 'setApprovalForAll',
    type: 'function',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
] as const

const CTF_SPLIT_ABI = [
  {
    name: 'splitPosition',
    type: 'function',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

const CTF_MERGE_ABI = [
  {
    name: 'mergePositions',
    type: 'function',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'partition', type: 'uint256[]' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

const CTF_REDEEM_ABI = [
  {
    name: 'redeemPositions',
    type: 'function',
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId', type: 'bytes32' },
      { name: 'indexSets', type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const

function isBytes32Hex(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s)
}

function toUsdcBaseUnits(shares: number): bigint {
  if (!Number.isFinite(shares) || shares <= 0) return 0n
  return parseUnits(String(shares), 6)
}

function normalizePrivateKey(pk: string): `0x${string}` {
  return pk.startsWith('0x') ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`)
}

function readRelayerEnv(): RelayerEnv {
  const cfg = loadPolymarketConfigFromEnv()
  const privateKey = cfg.privateKey
  if (!privateKey) {
    throw new Error('[relayer] missing PRIVATE_KEY (or POLYMARKET_PRIVATE_KEY)')
  }
  const apiKey = process.env.POLYMARKET_BUILDER_API_KEY
  const apiSecret = process.env.POLYMARKET_BUILDER_API_SECRET
  const apiPassphrase = process.env.POLYMARKET_BUILDER_API_PASSPHRASE
  if (!apiKey || !apiSecret || !apiPassphrase) {
    throw new Error(
      '[relayer] missing POLYMARKET_BUILDER_API_KEY/SECRET/PASSPHRASE (builder creds required for relayer)',
    )
  }
  const relayerUrl = process.env.POLYMARKET_RELAYER_URL ?? DEFAULT_RELAYER_URL
  const chainIdRaw = process.env.POLYMARKET_RELAYER_CHAIN_ID
  const chainId = chainIdRaw ? Number(chainIdRaw) : 137
  if (!Number.isFinite(chainId)) {
    throw new Error(`[relayer] invalid POLYMARKET_RELAYER_CHAIN_ID=${chainIdRaw}`)
  }
  const txTypeRaw = (process.env.POLYMARKET_RELAYER_TX_TYPE ?? 'SAFE').toUpperCase()
  const txType =
    txTypeRaw === 'PROXY' ? RelayerTxType.PROXY : RelayerTxType.SAFE

  return {
    relayerUrl,
    chainId,
    txType,
    privateKey,
    apiKey,
    apiSecret,
    apiPassphrase,
  }
}

function createRelayerClient(): RelayClient {
  const env = readRelayerEnv()
  const account = privateKeyToAccount(normalizePrivateKey(env.privateKey))
  const wallet = createWalletClient({
    account,
    chain: polygon,
    transport: http(process.env.POLYGON_RPC_URL),
  })
  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: env.apiKey,
      secret: env.apiSecret,
      passphrase: env.apiPassphrase,
    },
  })
  return new RelayClient(env.relayerUrl, env.chainId, wallet, builderConfig, env.txType)
}

export async function deploySafeIfNeeded(): Promise<{
  proxyAddress: string
  transactionHash: string
} | null> {
  const client = createRelayerClient()
  const response = await client.deploy()
  const result = await response.wait()
  if (!result) return null
  return {
    proxyAddress: result.proxyAddress,
    transactionHash: result.transactionHash,
  }
}

export async function getExpectedSafeAddress(): Promise<string> {
  const client = createRelayerClient() as unknown as {
    getExpectedSafe: () => Promise<string>
  }
  if (typeof client.getExpectedSafe !== 'function') {
    throw new Error('[relayer] getExpectedSafe not available on RelayClient')
  }
  return client.getExpectedSafe()
}

export async function splitViaRelayer(
  args: SplitViaRelayerArgs,
): Promise<{ txHash: string; splitShares: number }> {
  if (!isBytes32Hex(args.conditionId)) {
    throw new Error(`[relayer] invalid conditionId (expected bytes32 hex)`)
  }
  const amount = toUsdcBaseUnits(args.shares)
  if (amount <= 0n) {
    throw new Error(`[relayer] invalid shares=${args.shares}`)
  }

  const tx: Transaction = {
    to: CONDITIONAL_TOKENS_ADDRESS,
    data: encodeFunctionData({
      abi: CTF_SPLIT_ABI,
      functionName: 'splitPosition',
      args: [USDC_ADDRESS, zeroHash, args.conditionId, [1n, 2n], amount],
    }),
    value: '0',
  }

  const client = createRelayerClient()
  const response = await client.execute([tx], 'split via relayer')
  const result = await response.wait()
  if (!result?.transactionHash) {
    console.log('🔴🔴🔴[relayer] split failed🔴🔴🔴');
    console.log('RESULT:', JSON.stringify(result, null, 2))  // <-- dodaj ovo
    console.log('🔴🔴🔴[relayer] split failed🔴🔴🔴');
    throw new Error('[relayer] split failed (no transactionHash)')
  }
  return { txHash: result.transactionHash, splitShares: args.shares }
}

export async function mergeViaRelayer(
  args: SplitViaRelayerArgs,
): Promise<{ txHash: string; mergedShares: number }> {
  if (!isBytes32Hex(args.conditionId)) {
    throw new Error('[relayer] invalid conditionId (expected bytes32 hex)')
  }
  const amount = toUsdcBaseUnits(args.shares)
  if (amount <= 0n) {
    throw new Error(`[relayer] invalid shares=${args.shares}`)
  }

  const tx: Transaction = {
    to: CONDITIONAL_TOKENS_ADDRESS,
    data: encodeFunctionData({
      abi: CTF_MERGE_ABI,
      functionName: 'mergePositions',
      args: [USDC_ADDRESS, zeroHash, args.conditionId, [1n, 2n], amount],
    }),
    value: '0',
  }

  const client = createRelayerClient()
  const response = await client.execute([tx], 'merge via relayer')
  const result = await response.wait()
  if (!result?.transactionHash) {
    throw new Error('[relayer] merge failed (no transactionHash)')
  }
  return { txHash: result.transactionHash, mergedShares: args.shares }
}

export async function redeemViaRelayer(args: {
  conditionId: string
}): Promise<{ txHash: string }> {
  if (!isBytes32Hex(args.conditionId)) {
    throw new Error('[relayer] invalid conditionId (expected bytes32 hex)')
  }

  const tx: Transaction = {
    to: CONDITIONAL_TOKENS_ADDRESS,
    data: encodeFunctionData({
      abi: CTF_REDEEM_ABI,
      functionName: 'redeemPositions',
      args: [USDC_ADDRESS, zeroHash, args.conditionId, [1n, 2n]],
    }),
    value: '0',
  }

  const client = createRelayerClient()
  const response = await client.execute([tx], 'redeem via relayer')
  const result = await response.wait()
  if (!result?.transactionHash) {
    throw new Error('[relayer] redeem failed (no transactionHash)')
  }
  return { txHash: result.transactionHash }
}

export async function approveViaRelayer(
  args: ApproveViaRelayerArgs,
): Promise<{ txHash: string }> {
  const { exchange } = await getContractAddresses(args.clobHost, args.chainId)

  const approveUsdcCtf: Transaction = {
    to: USDC_ADDRESS,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [CONDITIONAL_TOKENS_ADDRESS, 2n ** 256n - 1n],
    }),
    value: '0',
  }

  const approveUsdcExchange: Transaction = {
    to: USDC_ADDRESS,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [exchange, 2n ** 256n - 1n],
    }),
    value: '0',
  }

  const approveCtfExchange: Transaction = {
    to: CONDITIONAL_TOKENS_ADDRESS,
    data: encodeFunctionData({
      abi: ERC1155_ABI,
      functionName: 'setApprovalForAll',
      args: [exchange, true],
    }),
    value: '0',
  }

  const client = createRelayerClient()
  const response = await client.execute(
    [approveUsdcCtf, approveUsdcExchange, approveCtfExchange],
    'approve USDC+CTF for exchange',
  )
  const result = await response.wait()
  if (!result?.transactionHash) {
    throw new Error('[relayer] approve failed (no transactionHash)')
  }
  return { txHash: result.transactionHash }
}

export async function withdrawUsdcViaRelayer(
  args: WithdrawUsdcViaRelayerArgs,
): Promise<{ txHash: string }> {
  if (!args.to || !args.to.startsWith('0x')) {
    throw new Error('[relayer] invalid withdraw address')
  }
  const amount = toUsdcBaseUnits(args.amount)
  if (amount <= 0n) {
    throw new Error(`[relayer] invalid amount=${args.amount}`)
  }
  const tx: Transaction = {
    to: USDC_ADDRESS,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [args.to, amount],
    }),
    value: '0',
  }

  const client = createRelayerClient()
  const response = await client.execute([tx], 'withdraw usdc')
  const result = await response.wait()
  if (!result?.transactionHash) {
    throw new Error('[relayer] withdraw failed (no transactionHash)')
  }
  return { txHash: result.transactionHash }
}
