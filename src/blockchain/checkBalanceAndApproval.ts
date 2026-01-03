import { Wallet, JsonRpcProvider, Contract, formatUnits } from 'ethers'

/**
 * USDC.e on Polygon mainnet
 */
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'

/**
 * Known Polymarket contract addresses on Polygon (chainId 137)
 */
const POLYMARKET_CONTRACTS = {
  // Conditional Tokens Framework (ERC1155) - single contract for all conditional tokens
  CONDITIONAL_TOKENS: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  // Current CLOB Exchange contract (NegRisk multi-outcome markets)
  // EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D35d77Ee40f5F0',
  // dobra
  EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
} as const

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
  privateKey: string
  /**
   * Chain ID (default: 137 for Polygon mainnet)
   */
  chainId?: number
  /**
   * CLOB host (e.g., https://clob.polymarket.com)
   */
  clobHost: string
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
   * Exchange contract address (fetched from API or fallback)
   */
  exchangeAddress: string
  /**
   * Conditional token contract address
   */
  conditionalTokenAddress: string
}

/**
 * Fetches contract addresses from Polymarket CLOB API.
 * Falls back to known addresses if API call fails.
 */
async function getContractAddresses(
  clobHost: string,
  chainId: number,
): Promise<{ exchange: string; conditionalTokens: string }> {
  try {
    // Try to fetch from API /info endpoint
    const response = await fetch(`${clobHost}/info`)
    if (response.ok) {
      const data = (await response.json()) as unknown
      // The API might return contract addresses in different formats
      // Adjust based on actual API response structure
      if (data && typeof data === 'object') {
        const info = data as Record<string, unknown>
        const exchange = info.exchangeAddress || info.exchange
        if (typeof exchange === 'string') {
          return {
            exchange,
            conditionalTokens: POLYMARKET_CONTRACTS.CONDITIONAL_TOKENS,
          }
        }
      }
    }
  } catch (err) {
    console.warn('[blockchain][⛔️] Failed to fetch contract addresses from API:', err)
  }

  // Fallback: Known addresses (may need to be updated)
  // For Polygon mainnet (chainId 137)
  if (chainId === 137) {
    return {
      exchange: POLYMARKET_CONTRACTS.EXCHANGE,
      conditionalTokens: POLYMARKET_CONTRACTS.CONDITIONAL_TOKENS,
    }
  }

  throw new Error(`Unknown chainId ${chainId}, cannot determine contract addresses`)
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
  const wallet = new Wallet(opts.privateKey, provider)
  const address = await wallet.getAddress()

  // Get contract addresses
  const contracts = await getContractAddresses(opts.clobHost, chainId)
  const exchangeAddress = contracts.exchange
  const conditionalTokenAddress = contracts.conditionalTokens

  // Get USDC contract
  const usdcContract = new Contract(USDC_ADDRESS, ERC20_ABI, provider)
  const decimals = await usdcContract.decimals!()

  // Check USDC balance
  const usdcBalanceRaw = await usdcContract.balanceOf!(address)
  const usdcBalance = formatUnits(usdcBalanceRaw, decimals)

  // Check USDC allowance for Exchange contract
  const usdcAllowanceRaw = await usdcContract.allowance!(address, exchangeAddress)
  const usdcAllowance = formatUnits(usdcAllowanceRaw, decimals)

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

    console.log(`[blockchain] Wallet address: ${result.address}`)
    console.log(`[blockchain] Exchange contract: ${result.exchangeAddress}`)
    console.log(`[blockchain] Conditional token contract: ${result.conditionalTokenAddress}`)
    console.log(`[blockchain] USDC balance: ${result.usdcBalance} USDC`)
    console.log(`[blockchain] USDC allowance for Exchange: ${result.usdcAllowance} USDC`)
    console.log(
      `[blockchain] Conditional tokens approved (ERC1155): ${result.conditionalTokensApproved ? 'YES' : 'NO'}`,
    )

    let hasErrors = false

    if (result.usdcBalanceRaw === 0n) {
      console.error(
        `${RED}[blockchain][⛔️] ERROR: USDC balance is 0. You need USDC to buy shares.${RESET}`,
      )
      hasErrors = true
    }

    if (result.usdcAllowanceRaw === 0n) {
      console.error(
        `${RED}[blockchain][⛔️] ERROR: USDC allowance is 0. You need to approve USDC for the Exchange contract.${RESET}`,
      )
      hasErrors = true
    }

    if (!result.conditionalTokensApproved) {
      console.error(
        `${RED}[blockchain][⛔️] ERROR: Conditional tokens not approved. You need to call setApprovalForAll on the conditional token contract.${RESET}`,
      )
      hasErrors = true
    }

    if (hasErrors) {
      console.error(
        `${RED}[blockchain][⛔️] FATAL: Missing required approvals or balance. Trading bot cannot start.${RESET}`,
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

