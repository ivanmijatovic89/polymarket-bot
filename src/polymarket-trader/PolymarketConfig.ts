/**
 * Configuration for Polymarket trading operations
 *
 * Centralizes all network-specific settings including:
 * - RPC endpoints for blockchain communication
 * - Contract addresses for USDC, CTF, and Exchange
 * - Chain IDs for transaction signing
 * - API endpoints for CLOB operations
 *
 * USAGE:
 * ```typescript
 * const config = new PolymarketConfig(true); // mainnet
 * const testConfig = new PolymarketConfig(false); // testnet
 *
 * console.log(config.contracts.usdc); // USDC contract address
 * console.log(config.rpcUrl); // RPC endpoint
 * ```
 */
export class PolymarketConfig {
  /** Polygon chain ID (137 for mainnet, 80001 for Amoy testnet) */
  readonly chainId: number;

  /** RPC endpoint URL for blockchain queries and transactions */
  readonly rpcUrl: string;

  /** Critical contract addresses for trading operations */
  readonly contracts: {
    /** USDC stablecoin contract (6 decimals) */
    usdc: string;
    /** Conditional Token Framework contract for position tokens */
    conditionalTokens: string;
    /** Polymarket Exchange contract for order settlement */
    exchange: string;
  };

  /** Whether this config is for mainnet (true) or testnet (false) */
  readonly isMainnet: boolean;

  /**
   * Creates a new configuration instance
   *
   * @param isMainnet - True for Polygon mainnet, false for Amoy testnet
   */
  constructor(isMainnet: boolean = true) {
    this.isMainnet = isMainnet;

    // Chain ID determines which network transactions are signed for
    // 137 = Polygon mainnet, 80001 = Polygon Amoy testnet
    this.chainId = isMainnet ? 137 : 80001;

    // RPC URLs for blockchain communication
    // Mainnet uses public Polygon RPC, testnet uses Amoy
    this.rpcUrl = isMainnet
      ? "https://polygon-rpc.com"
      : "https://rpc-amoy.polygon.technology";

    // Contract addresses differ between mainnet and testnet
    // These are the official Polymarket deployment addresses
    this.contracts = isMainnet ? {
      // Mainnet contracts (production with real money)
      usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
      exchange: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
    } : {
      // Amoy testnet contracts (for testing, no real value)
      usdc: "0x9c4e1703476e875070ee25b56a58b008cfb8fa78",
      conditionalTokens: "0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB",
      exchange: "0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40",
    };

    // Validate all addresses are properly formatted
    this.validateAddresses();
  }

  /**
   * Validates that all contract addresses are properly formatted
   * @throws {Error} If any address is invalid
   */
  private validateAddresses(): void {
    const addresses = [
      { name: 'USDC', value: this.contracts.usdc },
      { name: 'ConditionalTokens', value: this.contracts.conditionalTokens },
      { name: 'Exchange', value: this.contracts.exchange },
    ];

    for (const { name, value } of addresses) {
      if (!this.isValidAddress(value)) {
        throw new Error(`Invalid ${name} contract address: ${value}`);
      }
    }
  }

  /**
   * Checks if a string is a valid Ethereum address
   * @param address - Address to validate
   * @returns True if valid, false otherwise
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Get human-readable network name
   * @returns "Polygon Mainnet" or "Polygon Amoy Testnet"
   */
  get networkName(): string {
    return this.isMainnet ? "Polygon Mainnet" : "Polygon Amoy Testnet";
  }

  /**
   * Get host URL for Polymarket CLOB API
   *
   * The CLOB (Central Limit Order Book) API is used for:
   * - Placing and canceling orders
   * - Fetching orderbook data
   * - Managing API credentials
   *
   * @returns API host URL (same for mainnet and testnet)
   */
  get host(): string {
    return 'https://clob.polymarket.com';
  }
}

/**
 * Trading parameters and operational limits
 *
 * Contains default values and constraints for trading operations.
 * These can be overridden per-order but provide sensible defaults.
 *
 * USAGE:
 * ```typescript
 * const tradingConfig = new TradingConfig();
 * if (orderSize < tradingConfig.minOrderSize) {
 *   throw new Error("Order too small");
 * }
 * ```
 */
export class TradingConfig {
  /** Default tick size (price increment) for orders - usually 0.01 ($0.01) */
  readonly defaultTickSize: string = "0.01";

  /**
   * Default negative risk flag
   * False for standard binary markets, true for markets with negative risk
   * (where one outcome has special handling)
   */
  readonly defaultNegRisk: boolean = false;

  /**
   * Default signature type for transactions
   * - 0: EOA (Externally Owned Account) - standard wallet
   * - 1: Poly Proxy - Polymarket's proxy contract
   * - 2: EIP1271 - Smart contract signature verification
   */
  readonly defaultSignatureType: number = 0;

  /**
   * Minimum order size in number of shares
   * Orders smaller than this will be rejected
   */
  readonly minOrderSize: number = 0.01;

  /**
   * Maximum number of retry attempts for failed operations
   * Used for network errors, rate limits, etc.
   */
  readonly maxRetries: number = 3;

  /**
   * Delay between retry attempts in milliseconds
   * Uses exponential backoff: delay * attemptNumber
   */
  readonly retryDelayMs: number = 1000;
}

/**
 * ERC20 ABI for token interactions (USDC contract methods)
 *
 * Defines the minimal ABI needed to interact with USDC tokens.
 * USDC is an ERC20 token used as the base currency for Polymarket trading.
 *
 * Key methods:
 * - approve: Grant spending permission to another address
 * - allowance: Check how much a spender is allowed to use
 * - balanceOf: Check token balance for an address
 * - decimals: Get token precision (6 for USDC)
 * - symbol: Get token symbol ("USDC")
 * - transfer: Send tokens to another address
 */
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

/**
 * Conditional Tokens Framework (CTF) ABI for position token interactions
 *
 * The CTF is an ERC1155 multi-token contract that holds prediction market positions.
 * Unlike ERC20, ERC1155 uses "operator approval" instead of per-token allowances.
 *
 * Key methods:
 * - setApprovalForAll: Grant an operator permission to manage ALL your position tokens
 * - isApprovedForAll: Check if an operator has full approval
 * - mergePositions: Convert a complete set of outcome tokens back to collateral (USDC)
 * - redeemPositions: Redeem winning positions after market settlement
 *
 * SECURITY NOTE: setApprovalForAll grants access to ALL position tokens at once,
 * not just a specific market. This is required for trading on Polymarket.
 */
export const CTF_ABI = [
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
] as const;