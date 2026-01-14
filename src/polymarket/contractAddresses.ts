/**
 * USDC.e on Polygon mainnet.
 */
export const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'

/**
 * Polymarket Conditional Tokens Framework (ERC1155) on Polygon mainnet.
 */
export const CONDITIONAL_TOKENS_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'

/**
 * Known Polymarket contract addresses on Polygon (chainId 137).
 */
const POLYMARKET_CONTRACTS = {
  // Current CLOB Exchange contract (NegRisk multi-outcome markets)
  EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
} as const

export type PolymarketContractAddresses = {
  exchange: string
  conditionalTokens: string
}

/**
 * Fetch contract addresses from Polymarket CLOB API.
 * Falls back to known addresses if API call fails.
 */
export async function getContractAddresses(
  clobHost: string,
  chainId: number,
): Promise<PolymarketContractAddresses> {
  try {
    const response = await fetch(`${clobHost}/info`)
    if (response.ok) {
      const data = (await response.json()) as unknown
      if (data && typeof data === 'object') {
        const info = data as Record<string, unknown>
        const exchange = info.exchangeAddress || info.exchange
        if (typeof exchange === 'string') {
          return {
            exchange,
            conditionalTokens: CONDITIONAL_TOKENS_ADDRESS,
          }
        }
      }
    }
  } catch (err) {
    console.warn('[contracts][⛔️] Failed to fetch contract addresses from API:', err)
  }

  if (chainId === 137) {
    return {
      exchange: POLYMARKET_CONTRACTS.EXCHANGE,
      conditionalTokens: CONDITIONAL_TOKENS_ADDRESS,
    }
  }

  throw new Error(`Unknown chainId ${chainId}, cannot determine contract addresses`)
}
