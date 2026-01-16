import { Contract, JsonRpcProvider, Wallet, ZeroHash } from 'ethers'

import { CONDITIONAL_TOKENS_ADDRESS, USDC_ADDRESS } from '../polymarket/contractAddresses.js'

/**
 * Minimal ABI required for merging binary outcome positions back to collateral.
 *
 * Canonical signature (CTF):
 * mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)
 */
const CONDITIONAL_TOKENS_ABI = [
  'function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
  'function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
] as const

function toUsdcBaseUnits(shares: number): bigint {
  if (!Number.isFinite(shares) || shares <= 0) return 0n
  // Shares in this project are in "1 USDC per share" units. USDC has 6 decimals.
  return BigInt(Math.round(shares * 1e6))
}

function isBytes32Hex(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s)
}

export async function mergeBinaryOutcomePositions(params: {
  rpcUrl: string
  chainId: number
  privateKey: string
  /**
   * CTF conditionId (bytes32 hex string). We currently assume MarketOrderBooksSnapshot.market is this.
   */
  conditionId: string
  /**
   * Merge amount in shares (same unit as strategy sizes).
   */
  shares: number
}): Promise<{ txHash: string; mergedShares: number }> {
  const { rpcUrl, chainId, privateKey, conditionId, shares } = params
  if (!isBytes32Hex(conditionId)) {
    throw new Error(`[ctf] invalid conditionId (expected bytes32 hex), got=${JSON.stringify(conditionId)}`)
  }

  const amount = toUsdcBaseUnits(shares)
  if (amount <= 0n) {
    throw new Error(`[ctf] invalid shares=${shares}`)
  }

  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true })
  const wallet = new Wallet(privateKey, provider)
  const ctf = new Contract(CONDITIONAL_TOKENS_ADDRESS, CONDITIONAL_TOKENS_ABI, wallet)

  // For binary markets, partition is [1, 2] (index sets).
  const partition = [1n, 2n]
  // ethers Contract typing can be conservative about fragment presence; ABI guarantees this exists.
  const tx = await (ctf as unknown as { mergePositions: (...args: unknown[]) => Promise<{ wait: () => Promise<{ hash?: string }>; hash: string }> }).mergePositions(
    USDC_ADDRESS,
    ZeroHash,
    conditionId,
    partition,
    amount,
  )
  const receipt = await tx.wait()
  const txHash: string = receipt?.hash ?? tx.hash

  return { txHash, mergedShares: shares }
}

export async function splitBinaryOutcomePositions(params: {
  rpcUrl: string
  chainId: number
  privateKey: string
  /**
   * CTF conditionId (bytes32 hex string). We currently assume MarketOrderBooksSnapshot.market is this.
   */
  conditionId: string
  /**
   * Split amount in shares (same unit as strategy sizes).
   */
  shares: number
}): Promise<{ txHash: string; splitShares: number }> {
  const { rpcUrl, chainId, privateKey, conditionId, shares } = params
  if (!isBytes32Hex(conditionId)) {
    throw new Error(`[ctf] invalid conditionId (expected bytes32 hex), got=${JSON.stringify(conditionId)}`)
  }

  const amount = toUsdcBaseUnits(shares)
  if (amount <= 0n) {
    throw new Error(`[ctf] invalid shares=${shares}`)
  }

  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true })
  const wallet = new Wallet(privateKey, provider)
  const ctf = new Contract(CONDITIONAL_TOKENS_ADDRESS, CONDITIONAL_TOKENS_ABI, wallet)

  // For binary markets, partition is [1, 2] (index sets).
  // Docs: https://docs.polymarket.com/developers/CTF/split
  const partition = [1n, 2n]
  // ethers Contract typing can be conservative about fragment presence; ABI guarantees this exists.
  const tx = await (ctf as unknown as { splitPosition: (...args: unknown[]) => Promise<{ wait: () => Promise<{ hash?: string }>; hash: string }> }).splitPosition(
    USDC_ADDRESS,
    ZeroHash,
    conditionId,
    partition,
    amount,
  )
  const receipt = await tx.wait()
  const txHash: string = receipt?.hash ?? tx.hash

  return { txHash, splitShares: shares }
}

export async function redeemBinaryOutcomePositions(params: {
  rpcUrl: string
  chainId: number
  privateKey: string
  /**
   * CTF conditionId (bytes32 hex string). We currently assume MarketOrderBooksSnapshot.market is this.
   */
  conditionId: string
}): Promise<{ txHash: string }> {
  const { rpcUrl, chainId, privateKey, conditionId } = params
  if (!isBytes32Hex(conditionId)) {
    throw new Error(`[ctf] invalid conditionId (expected bytes32 hex), got=${JSON.stringify(conditionId)}`)
  }

  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true })
  const wallet = new Wallet(privateKey, provider)
  const ctf = new Contract(CONDITIONAL_TOKENS_ADDRESS, CONDITIONAL_TOKENS_ABI, wallet)

  // For binary markets, indexSets is [1, 2] (index sets).
  const indexSets = [1n, 2n]
  const tx = await (ctf as unknown as {
    redeemPositions: (...args: unknown[]) => Promise<{ wait: () => Promise<{ hash?: string }>; hash: string }>
  }).redeemPositions(USDC_ADDRESS, ZeroHash, conditionId, indexSets)
  const receipt = await tx.wait()
  const txHash: string = receipt?.hash ?? tx.hash

  return { txHash }
}


