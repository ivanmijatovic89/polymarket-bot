import { Wallet, JsonRpcProvider, Contract, formatUnits } from 'ethers'

import {
  CONDITIONAL_TOKENS_ADDRESS,
  USDC_ADDRESS,
  getContractAddresses,
} from '../polymarket/contractAddresses.js'

/**
 * ERC20 ABI for balance and allowance checks
 */
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const

/**
 * ERC1155 ABI for checking setApprovalForAll
 */
const ERC1155_ABI = [
  'function isApprovedForAll(address account, address operator) view returns (bool)',
] as const

export type CheckBalanceAndApprovalOptions = {
  /**
   * RPC provider URL for Polygon (or other chain)
   * Example: 'https://polygon-rpc.com' or 'https://rpc.ankr.com/polygon'
   */
  rpcUrl: string
  /**
   * User's private key
   */
  privateKey?: string
  /**
   * Chain ID (default: 137 for Polygon mainnet)
   */
  chainId?: number
  /**
   * CLOB host (e.g., https://clob.polymarket.com)
   */
  clobHost: string
  /**
   * Optional override address (e.g., SAFE funder).
   * If provided, checks balances/allowances for this address instead of privateKey-derived EOA.
   */
  addressOverride?: string
  /**
   * Optional label for logging.
   */
  addressLabel?: string
}

export type BalanceAndApprovalResult = {
  /**
   * User's wallet address
   */
  address: string
  /**
   * USDC balance (formatted as string with decimals)
   */
  usdcBalance: string
  /**
   * USDC balance in raw units (wei)
   */
  usdcBalanceRaw: bigint
  /**
   * Whether Exchange contract is approved for all conditional tokens (ERC1155)
   * This approval covers ALL token IDs in the contract (all markets)
   */
  conditionalTokensApproved: boolean
  /**
   * USDC allowance for Exchange contract
   */
  usdcAllowance: string
  /**
   * USDC allowance in raw units (wei)
   */
  usdcAllowanceRaw: bigint
  /**
   * USDC allowance for CTF contract (split/redeem)
   */
  usdcCtfAllowance: string
  /**
   * USDC allowance in raw units (wei) for CTF
   */
  usdcCtfAllowanceRaw: bigint
  /**
   * Exchange contract address (fetched from API or fallback)
   */
  exchangeAddress: string
  /**
   * Conditional token contract address
   */
  conditionalTokenAddress: string
}

/**
 * Checks user's USDC balance and token approvals for Polymarket trading.
 *
 * Checks:
 * - USDC balance (needed for buying shares)
 * - Conditional token contract approval via isApprovedForAll (ERC1155)
 *   This approval covers ALL conditional tokens across ALL markets (if using single contract)
 * - USDC allowance for Exchange contract (ERC20)
 */
export async function checkBalanceAndApproval(
  opts: CheckBalanceAndApprovalOptions,
): Promise<BalanceAndApprovalResult> {
  const chainId = opts.chainId ?? 137
  const provider = new JsonRpcProvider(opts.rpcUrl, chainId, { staticNetwork: true })
  if (!opts.addressOverride && !opts.privateKey) {
    throw new Error('[blockchain] missing privateKey or addressOverride')
  }
  const address = opts.addressOverride
    ? opts.addressOverride
    : await new Wallet(opts.privateKey as string, provider).getAddress()

  // Get contract addresses
  const contracts = await getContractAddresses(opts.clobHost, chainId)
  const exchangeAddress = contracts.exchange
  const conditionalTokenAddress = contracts.conditionalTokens ?? CONDITIONAL_TOKENS_ADDRESS

  // Get USDC contract
  const usdcContract = new Contract(USDC_ADDRESS, ERC20_ABI, provider)
  const decimals = await usdcContract.decimals!()

  // Check USDC balance
  const usdcBalanceRaw = await usdcContract.balanceOf!(address)
  const usdcBalance = formatUnits(usdcBalanceRaw, decimals)

  // Check USDC allowance for Exchange contract
  const usdcAllowanceRaw = await usdcContract.allowance!(address, exchangeAddress)
  const usdcAllowance = formatUnits(usdcAllowanceRaw, decimals)
  const usdcCtfAllowanceRaw = await usdcContract.allowance!(address, conditionalTokenAddress)
  const usdcCtfAllowance = formatUnits(usdcCtfAllowanceRaw, decimals)

  // Check ERC1155 approval (isApprovedForAll) on the conditional token contract
  // This approval covers ALL token IDs in the contract (all markets)
  let conditionalTokensApproved = false
  try {
    const conditionalTokenContract = new Contract(
      conditionalTokenAddress,
      ERC1155_ABI,
      provider,
    )
    conditionalTokensApproved = await conditionalTokenContract.isApprovedForAll!(
      address,
      exchangeAddress,
    )
  } catch (err) {
    console.warn('[blockchain][⛔️] Failed to check conditional token approval:', err)
  }

  return {
    address,
    usdcBalance,
    usdcBalanceRaw,
    conditionalTokensApproved,
    usdcAllowance,
    usdcAllowanceRaw,
    usdcCtfAllowance,
    usdcCtfAllowanceRaw,
    exchangeAddress,
    conditionalTokenAddress,
  }
}

/**
 * ANSI color codes for terminal output
 */
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

/**
 * Logs balance and approval status to console.
 * Throws error if approvals are missing (will stop bot).
 */
export async function logBalanceAndApproval(
  opts: CheckBalanceAndApprovalOptions,
): Promise<void> {
  try {
    const result = await checkBalanceAndApproval(opts)
    const label = opts.addressLabel ? ` ${opts.addressLabel}` : ''

    console.log(`[blockchain]${label} wallet address: ${result.address}`)
    console.log(`[blockchain]${label} exchange contract: ${result.exchangeAddress}`)
    console.log(`[blockchain]${label} conditional token contract: ${result.conditionalTokenAddress}`)
    console.log(`[blockchain]${label} USDC balance: ${result.usdcBalance} USDC`)
    console.log(`[blockchain]${label} USDC allowance for Exchange: ${result.usdcAllowance} USDC`)
    console.log(`[blockchain]${label} USDC allowance for CTF: ${result.usdcCtfAllowance} USDC`)
    console.log(
      `[blockchain]${label} conditional tokens approved (ERC1155): ${result.conditionalTokensApproved ? 'YES' : 'NO'}`,
    )

    let hasErrors = false

    if (result.usdcBalanceRaw === 0n) {
      console.error(
        `${RED}[blockchain][⛔️]${label} ERROR: USDC balance is 0. You need USDC to buy shares.${RESET}`,
      )
      hasErrors = true
    }

    if (result.usdcAllowanceRaw === 0n) {
      console.error(
        `${RED}[blockchain][⛔️]${label} ERROR: USDC allowance is 0. You need to approve USDC for the Exchange contract.${RESET}`,
      )
      hasErrors = true
    }

    if (!result.conditionalTokensApproved) {
      console.error(
        `${RED}[blockchain][⛔️]${label} ERROR: Conditional tokens not approved. You need to call setApprovalForAll on the conditional token contract.${RESET}`,
      )
      hasErrors = true
    }

    if (hasErrors) {
      console.error(
        `${RED}[blockchain][⛔️]${label} FATAL: Missing required approvals or balance. Trading bot cannot start.${RESET}`,
      )
      throw new Error(
        'Missing required approvals or balance. Please approve tokens and ensure sufficient USDC balance.',
      )
    }
  } catch (err) {
    console.error('[blockchain][⛔️] Failed to check balance and approval:', err)
    throw err
  }
}

