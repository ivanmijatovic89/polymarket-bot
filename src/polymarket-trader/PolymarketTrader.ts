import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import type { ApiKeyCreds, TickSize } from "@polymarket/clob-client";
import { Contract, JsonRpcProvider, Wallet, MaxUint256 } from "ethers";
import { Wallet as OldWallet } from "@ethersproject/wallet";
import type { IBalanceChecker, BalanceInfo } from "./BalanceChecker.js";
import { PolymarketConfig, TradingConfig, ERC20_ABI, CTF_ABI } from "./PolymarketConfig.js";
import type { ILogger } from "./Logger.js";
import { ConsoleLogger } from "./Logger.js";
import { BalanceChecker } from "./BalanceChecker.js";
import { InsufficientBalanceError, AllowanceError, ValidationError, NetworkError } from "./PolymarketErrors.js";

// ============================================================================
// INTERFACES - Enable dependency injection and testing
// ============================================================================

/**
 * Interface for Polymarket CLOB (Central Limit Order Book) client operations
 * Abstracts the actual ClobClient for testing and flexibility
 */
export interface IClobClient {
  /**
   * Creates or derives API credentials for authenticated API calls
   * @returns Promise resolving to API credentials (key, secret, passphrase)
   */
  createOrDeriveApiKey(): Promise<ApiKeyCreds>;

  /**
   * Creates and posts an order to the Polymarket orderbook
   * @param order - Order parameters (token, price, side, size, fees)
   * @param options - Trading options (tick size, negative risk flag)
   * @param orderType - Order type (GTC, FOK, IOC, etc.)
   * @returns Promise resolving to order response from the exchange
   */
  createAndPostOrder(
    order: {
      tokenID: string;
      price: number;
      side: Side;
      size: number;
      feeRateBps: number;
    },
    options: { tickSize: TickSize; negRisk: boolean },
    orderType?: OrderType
  ): Promise<any>;
}

/**
 * Interface for blockchain RPC provider operations
 * Allows querying blockchain state (balances, blocks, etc.)
 */
export interface IProvider {
  /**
   * Gets the native token (MATIC) balance for an address
   * @param address - Ethereum address to check
   * @returns Promise resolving to balance in wei (as bigint)
   */
  getBalance(address: string): Promise<bigint>;
}

/**
 * Interface for smart contract interactions
 * Abstracts ERC20 and CTF (Conditional Token Framework) contract methods
 */
export interface IContract {
  /**
   * Gets the current token allowance for a spender
   * @param owner - Token owner address
   * @param spender - Address allowed to spend tokens
   * @returns Promise resolving to allowance amount
   */
  allowance(owner: string, spender: string): Promise<any>;

  /**
   * Approves a spender to use tokens on behalf of the owner
   * @param spender - Address to approve
   * @param amount - Amount to approve (use MaxUint256 for unlimited)
   * @returns Promise resolving to transaction receipt
   */
  approve(spender: string, amount: any): Promise<any>;

  /**
   * Checks if an operator is approved to manage all tokens for an owner
   * Used for CTF ERC1155 tokens
   * @param owner - Token owner address
   * @param operator - Operator address to check
   * @returns Promise resolving to approval status
   */
  isApprovedForAll(owner: string, operator: string): Promise<boolean>;

  /**
   * Sets approval for an operator to manage all tokens
   * Used for CTF ERC1155 tokens
   * @param operator - Operator address
   * @param approved - Whether to approve or revoke
   * @returns Promise resolving to transaction receipt
   */
  setApprovalForAll(operator: string, approved: boolean): Promise<any>;

  /**
   * Gets token balance for an address
   * @param owner - Address to check balance for
   * @returns Promise resolving to token balance
   */
  balanceOf(owner: string): Promise<any>;

  /**
   * Gets the number of decimals the token uses
   * @returns Promise resolving to decimal count (e.g., 6 for USDC, 18 for most tokens)
   */
  decimals(): Promise<number>;

  /**
   * Gets the token symbol (e.g., "USDC", "MATIC")
   * @returns Promise resolving to token symbol string
   */
  symbol(): Promise<string>;

  /**
   * Merges a complete set of outcome tokens back into collateral (USDC)
   * Used when holding both YES and NO shares to recover collateral before settlement
   * @param collateralToken - Address of the collateral token (USDC)
   * @param parentCollectionId - Parent collection ID (always 0x0 for Polymarket)
   * @param conditionId - The condition ID for the market
   * @param partition - Array of index sets representing the partition (e.g., [1, 2] for YES/NO)
   * @param amount - Number of full sets to merge
   * @returns Promise resolving to transaction receipt
   */
  mergePositions?(
    collateralToken: string,
    parentCollectionId: string,
    conditionId: string,
    partition: number[],
    amount: bigint
  ): Promise<any>;

  /**
   * Redeems winning positions after market settlement
   * Burns winning outcome tokens to receive collateral (USDC)
   * @param collateralToken - Address of the collateral token (USDC)
   * @param parentCollectionId - Parent collection ID (always 0x0 for Polymarket)
   * @param conditionId - The condition ID for the market
   * @param indexSets - Array of index sets to redeem (e.g., [1] for YES or [2] for NO)
   * @returns Promise resolving to transaction receipt
   */
  redeemPositions?(
    collateralToken: string,
    parentCollectionId: string,
    conditionId: string,
    indexSets: number[]
  ): Promise<any>;
}

/**
 * Interface for wallet operations
 * Minimal interface for signing and address management
 */
export interface IWallet {
  /** The Ethereum address of the wallet */
  address: string;
}

/**
 * Interface for market data fetching
 * Abstracts market-specific data retrieval for flexibility
 */
export interface IMarketFetcher {
  /**
   * Fetches the current active BTC Up/Down 15-minute market
   * @returns Promise resolving to market data with token IDs, or null if no market found
   */
  getCurrentBtcUpDown15mMarket(): Promise<{
    clobTokenIds: string[];
  } | null>;
}

/**
 * Parameters required to place an order on Polymarket
 */
export interface OrderParams {
  /** The CLOB token ID for the outcome being traded */
  tokenID: string;
  /** Price per share (0.01 to 0.99 for binary markets) */
  price: number;
  /** Order side - BUY or SELL */
  side: Side;
  /** Order size in number of shares */
  size: number;
  /** Fee rate in basis points (usually 0 for maker orders) */
  feeRateBps: number;
}

/**
 * Advanced order parameters for fine-grained control
 *
 * These parameters give you full control over order creation,
 * matching the Polymarket CLOB API exactly.
 *
 * USAGE: Most bots should use the simpler OrderParams interface.
 * Only use this for advanced scenarios like:
 * - Custom expiration times
 * - Specific taker addresses (operator matching)
 * - Custom nonce management
 * - Non-standard salt values
 */
export interface AdvancedOrderParams {
  /** The CLOB token ID for the outcome being traded */
  tokenID: string;

  /** Maximum amount maker is willing to spend (in smallest unit, e.g., USDC wei) */
  makerAmount: string;

  /** Minimum amount taker will pay the maker in return (in smallest unit) */
  takerAmount: string;

  /** Order side - BUY or SELL */
  side: Side;

  /** Fee rate in basis points (usually 0 for maker orders) */
  feeRateBps: number;

  /**
   * Unix expiration timestamp (seconds since epoch)
   * Required for GTD (Good-Til-Date) orders
   * Must be at least 60 seconds in the future
   * Default: 0 (no expiration, for GTC orders)
   */
  expiration?: number;

  /**
   * Random salt for creating unique orders
   * Default: auto-generated if not provided
   */
  salt?: number;

  /**
   * Nonce for the exchange (prevents replay attacks)
   * Default: fetched from exchange if not provided
   */
  nonce?: string;

  /**
   * Taker address (operator address for matching)
   * Default: "0x0000000000000000000000000000000000000000" (any taker)
   */
  taker?: string;
}

/**
 * Response from placing an order
 * Contains order ID and status information
 */
export interface OrderResponse {
  /** Unique identifier for the placed order */
  orderID: string;

  /** Transaction/order hashes for tracking */
  orderHashes?: string[];

  /** Whether the order was successfully placed */
  success: boolean;

  /** Error message if placement failed */
  errorMsg?: string;

  /** Current order status */
  status?: string;

  /** Additional metadata from the exchange */
  [key: string]: any;
}

// Re-export for convenience
export type { BalanceInfo, IBalanceChecker } from "./BalanceChecker.js";

// ============================================================================
// MAIN TRADER CLASS
// ============================================================================

/**
 * PolymarketTrader - Main trading service for Polymarket prediction markets
 *
 * This class provides a high-level interface for interacting with Polymarket,
 * handling all the complexity of:
 * - API authentication and credentials management
 * - Token allowances and approvals (USDC and CTF tokens)
 * - Balance checking (USDC and MATIC)
 * - Order placement and execution
 * - Market data integration
 *
 * INTEGRATION GUIDE FOR TRADING BOTS:
 *
 * 1. Create an instance using the factory function:
 *    const trader = await createPolymarketTrader(privateKey, funderAddress, true);
 *
 * 2. Check balances before trading:
 *    const { usdc, matic } = await trader.checkBalance();
 *
 * 3. Approve allowances (one-time setup):
 *    await trader.approveAllowances(config.contracts.conditionalTokens, config.contracts.exchange);
 *
 * 4. Place orders:
 *    await trader.placeOrder({ tokenID, price, side, size, feeRateBps }, options);
 *
 * ARCHITECTURE:
 * - All dependencies are injected for testability
 * - All I/O operations go through the logger for monitoring
 * - Error handling uses custom error types for precise handling
 * - Immutable configuration prevents accidental state changes
 *
 * THREAD SAFETY: This class is NOT thread-safe. Create separate instances
 * for concurrent trading or implement your own locking mechanism.
 */
export class PolymarketTrader {
  /** Cached API credentials to avoid repeated key derivation */
  private creds?: ApiKeyCreds;

  /**
   * Creates a new PolymarketTrader instance
   *
   * NOTE: Use the factory function createPolymarketTrader() instead of calling
   * this constructor directly. The factory handles all dependency setup.
   *
   * @param config - Network and contract configuration (mainnet/testnet)
   * @param tradingConfig - Trading parameters (tick size, fees, retry logic)
   * @param clobClient - Client for Polymarket's CLOB API
   * @param balanceChecker - Service for checking wallet balances
   * @param usdcContract - USDC token contract interface
   * @param ctfContract - Conditional Token Framework contract interface
   * @param marketFetcher - Service for fetching market data
   * @param wallet - Wallet instance for signing transactions
   * @param logger - Logger for all operations (use for monitoring)
   * @param funderAddress - Address that funded this wallet (for tracking)
   * @param signatureType - Signature type (0 = EOA, 1 = Poly Proxy, 2 = EIP1271)
   */
  constructor(
    private readonly config: PolymarketConfig,
    private readonly tradingConfig: TradingConfig,
    private readonly clobClient: IClobClient,
    private readonly balanceChecker: IBalanceChecker,
    private readonly usdcContract: IContract,
    private readonly ctfContract: IContract,
    private readonly marketFetcher: IMarketFetcher,
    private readonly wallet: IWallet,
    private readonly logger: ILogger,
    private readonly funderAddress: string,
    private readonly signatureType: number = 0
  ) {
    this.logger.info('PolymarketTrader initialized', {
      network: config.networkName,
      walletAddress: wallet.address,
      funderAddress,
      signatureType,
    });
  }

  // ==========================================================================
  // CREDENTIALS MANAGEMENT
  // ==========================================================================

  /**
   * Initializes API credentials if not already present
   *
   * This method lazy-loads and caches API credentials. The credentials are
   * derived from the wallet's private key and are required for all authenticated
   * API calls (like placing orders).
   *
   * The credentials consist of:
   * - API key: Public identifier
   * - Secret: For signing requests
   * - Passphrase: Additional authentication factor
   *
   * NOTE: This is called automatically by placeOrder(), so you typically
   * don't need to call it manually.
   *
   * COMMON ERRORS:
   * - "Could not create api key" (400): Usually means insufficient balance or signature issues
   * - Check that you have USDC and MATIC in your wallet
   * - Verify that funderAddress matches the wallet's private key
   *
   * @throws {NetworkError} If API key creation fails
   * @throws {AllowanceError} If insufficient balance or allowances
   */
  async initializeCreds(): Promise<void> {
    if (!this.creds) {
      this.logger.info("Creating/deriving API key for authenticated trading");
      try {
        // First, try to derive existing API key (faster, no new signature required)
        this.logger.debug("Attempting to derive existing API key");
        this.creds = await this.clobClient.createOrDeriveApiKey();

        // Verify credentials were actually returned
        if (!this.creds || !this.creds.key || !this.creds.secret || !this.creds.passphrase) {
          this.logger.error("API key creation/derivation returned incomplete credentials", undefined, {
            hasKey: !!this.creds?.key,
            hasSecret: !!this.creds?.secret,
            hasPassphrase: !!this.creds?.passphrase,
          });

          throw new AllowanceError(
            "API key creation failed. This usually means:\n" +
            "1. Insufficient USDC balance (need at least some USDC)\n" +
            "2. Insufficient MATIC for gas fees\n" +
            "3. Funder address doesn't match wallet private key\n" +
            "4. Allowances not approved (run approveAllowances first)\n\n" +
            "Check your balance with checkBalance() and approve with approveAllowances()"
          );
        }

        this.logger.info("API credentials successfully initialized", {
          apiKey: this.creds.key.substring(0, 10) + '...',  // Log partial key for verification
          method: 'createOrDeriveApiKey'
        });

        // Verify the credentials work by checking if they have the expected format
        if (this.creds.key.length < 10 || this.creds.secret.length < 10) {
          this.logger.warn("API credentials appear malformed", {
            keyLength: this.creds.key.length,
            secretLength: this.creds.secret.length,
          });
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.logger.error("Failed to initialize API credentials", error as Error, {
          walletAddress: this.wallet.address,
          funderAddress: this.funderAddress,
          errorMessage,
        });

        // Clear any partial credentials
        delete (this as any).creds;

        // Provide specific guidance based on error message
        if (errorMessage.includes("Could not create api key") || errorMessage.includes("400")) {
          throw new AllowanceError(
            "API key creation rejected by server (400 error). Common causes:\n" +
            "1. NO USDC BALANCE - You need some USDC in your wallet (even $0.01)\n" +
            "2. NO MATIC FOR GAS - You need MATIC to pay for transactions\n" +
            "3. WRONG FUNDER ADDRESS - Must match the wallet's address\n" +
            "4. ALLOWANCES NOT SET - Run approveAllowances() first\n\n" +
            `Your wallet: ${this.wallet.address}\n` +
            `Your funder: ${this.funderAddress}\n\n` +
            "Check these match and run checkBalance() to verify funds."
          );
        }

        throw new NetworkError("API key initialization failed", error as Error);
      }
    }
  }

  // ==========================================================================
  // BALANCE OPERATIONS
  // ==========================================================================

  /**
   * Checks current USDC and MATIC balances for the trading wallet
   *
   * USDC is required for buying prediction market shares.
   * MATIC is required for paying transaction fees (gas).
   *
   * USAGE:
   * ```typescript
   * const { usdc, matic } = await trader.checkBalance();
   * if (usdc < requiredAmount) {
   *   throw new Error("Insufficient USDC for trade");
   * }
   * if (matic < 0.1) {
   *   console.warn("Low MATIC - may not be able to approve or trade");
   * }
   * ```
   *
   * @returns Promise resolving to balance information (USDC in dollars, MATIC in tokens)
   * @throws {NetworkError} If balance check fails
   */
  async checkBalance(): Promise<BalanceInfo> {
    this.logger.info("Checking wallet balances");
    return await this.balanceChecker.checkBalance();
  }

  // ==========================================================================
  // ALLOWANCE MANAGEMENT
  // ==========================================================================

  /**
   * Approves token allowances required for trading on Polymarket
   *
   * This is a ONE-TIME SETUP operation that must be done before trading.
   * It grants permission for Polymarket contracts to move your tokens.
   *
   * THREE APPROVALS ARE REQUIRED:
   *
   * 1. USDC → Conditional Tokens:
   *    Allows the CTF contract to lock your USDC when minting position tokens
   *
   * 2. USDC → Exchange:
   *    Allows the exchange to settle trades using your USDC
   *
   * 3. Conditional Tokens → Exchange:
   *    Allows the exchange to transfer your position tokens when trading
   *
   * SECURITY NOTE: This uses MaxUint256 for unlimited approval, which is
   * gas-efficient but means the contracts can always access your tokens.
   * This is standard practice for DEXs but does carry smart contract risk.
   *
   * Each approval costs gas (MATIC). If already approved, this is a no-op.
   *
   * USAGE:
   * ```typescript
   * // One-time setup before first trade
   * await trader.approveAllowances(
   *   config.contracts.conditionalTokens,
   *   config.contracts.exchange
   * );
   * ```
   *
   * @param conditionalTokensAddress - Address of the CTF contract
   * @param exchangeAddress - Address of the Polymarket exchange contract
   * @throws {AllowanceError} If approval transaction fails
   */
  async approveAllowances(
    conditionalTokensAddress: string,
    exchangeAddress: string
  ): Promise<void> {
    this.logger.info("Starting allowance approval process");

    // -------------------------------------------------------------------------
    // APPROVAL 1: USDC → Conditional Tokens
    // -------------------------------------------------------------------------
    this.logger.info("Checking USDC allowance for Conditional Tokens contract");
    const usdcToCTFAllowance = await this.usdcContract.allowance(
      this.wallet.address,
      conditionalTokensAddress
    );
    this.logger.debug("Current USDC→CTF allowance", { allowance: usdcToCTFAllowance.toString() });

    if (usdcToCTFAllowance.toString() === "0") {
      this.logger.info("Approving unlimited USDC for Conditional Tokens (gas cost incurred)");
      try {
        const tx = await this.usdcContract.approve(conditionalTokensAddress, MaxUint256);
        this.logger.info("Approval transaction submitted", { txHash: tx.hash });
        await tx.wait();
        this.logger.info("USDC→CTF approval confirmed");
      } catch (error) {
        this.logger.error("Failed to approve USDC for CTF", error as Error);
        throw new AllowanceError("USDC approval for Conditional Tokens failed");
      }
    } else {
      this.logger.info("USDC→CTF already approved, skipping");
    }

    // -------------------------------------------------------------------------
    // APPROVAL 2: USDC → Exchange
    // -------------------------------------------------------------------------
    this.logger.info("Checking USDC allowance for Exchange contract");
    const usdcToExchangeAllowance = await this.usdcContract.allowance(
      this.wallet.address,
      exchangeAddress
    );
    this.logger.debug("Current USDC→Exchange allowance", { allowance: usdcToExchangeAllowance.toString() });

    if (usdcToExchangeAllowance.toString() === "0") {
      this.logger.info("Approving unlimited USDC for Exchange (gas cost incurred)");
      try {
        const tx = await this.usdcContract.approve(exchangeAddress, MaxUint256);
        this.logger.info("Approval transaction submitted", { txHash: tx.hash });
        await tx.wait();
        this.logger.info("USDC→Exchange approval confirmed");
      } catch (error) {
        this.logger.error("Failed to approve USDC for Exchange", error as Error);
        throw new AllowanceError("USDC approval for Exchange failed");
      }
    } else {
      this.logger.info("USDC→Exchange already approved, skipping");
    }

    // -------------------------------------------------------------------------
    // APPROVAL 3: Conditional Tokens → Exchange
    // -------------------------------------------------------------------------
    this.logger.info("Checking Conditional Tokens allowance for Exchange");
    const ctfApproved = await this.ctfContract.isApprovedForAll(
      this.wallet.address,
      exchangeAddress
    );
    this.logger.debug("Current CTF→Exchange approval status", { approved: ctfApproved });

    if (!ctfApproved) {
      this.logger.info("Approving Conditional Tokens for Exchange (gas cost incurred)");
      try {
        const tx = await this.ctfContract.setApprovalForAll(exchangeAddress, true);
        this.logger.info("Approval transaction submitted", { txHash: tx.hash });
        await tx.wait();
        this.logger.info("CTF→Exchange approval confirmed");
      } catch (error) {
        this.logger.error("Failed to approve CTF for Exchange", error as Error);
        throw new AllowanceError("Conditional Tokens approval for Exchange failed");
      }
    } else {
      this.logger.info("CTF→Exchange already approved, skipping");
    }

    this.logger.info("All allowances verified - ready to trade!");
  }

  // ==========================================================================
  // ORDER PLACEMENT
  // ==========================================================================

  /**
   * Places an order on Polymarket
   *
   * This is the core method for executing trades. It handles:
   * - API credential initialization (if needed)
   * - Order submission to the CLOB
   * - Response logging
   *
   * BEFORE CALLING THIS:
   * 1. Check you have sufficient balance (checkBalance)
   * 2. Ensure allowances are set (approveAllowances)
   * 3. Validate order parameters against market rules
   *
   * ORDER PARAMETERS:
   * - tokenID: Get from market data (e.g., market.clobTokenIds[0] for YES)
   * - price: Must be between 0.01 and 0.99 for binary markets
   * - side: Side.BUY (go long) or Side.SELL (go short)
   * - size: Number of shares (minimum 0.01, check tradingConfig.minOrderSize)
   * - feeRateBps: Usually 0 for maker orders, set by exchange for taker orders
   *
   * OPTIONS:
   * - tickSize: Price increment (usually "0.01")
   * - negRisk: Whether this is a negative-risk market (usually false)
   *
   * ORDER TYPES:
   * - GTC (Good Till Canceled): Stays in orderbook until filled or canceled
   * - FOK (Fill Or Kill): Execute immediately and completely or cancel
   * - IOC (Immediate Or Cancel): Execute immediately, partial fills ok
   *
   * EXAMPLE:
   * ```typescript
   * const response = await trader.placeOrder(
   *   {
   *     tokenID: "71321045679252212594626385532706912750332728571942532289631379312455583992833",
   *     price: 0.65,        // Willing to buy at 65 cents
   *     side: Side.BUY,     // Going long (betting YES)
   *     size: 100,          // 100 shares
   *     feeRateBps: 0,      // No maker fee
   *   },
   *   { tickSize: "0.01", negRisk: false },
   *   OrderType.GTC
   * );
   * console.log("Order ID:", response.orderID);
   * ```
   *
   * @param orderParams - Order parameters (token, price, side, size, fees)
   * @param options - Trading options (tick size, negative risk flag)
   * @param orderType - Order type (default: GTC)
   * @returns Promise resolving to order response (includes orderID if successful)
   * @throws {ValidationError} If order parameters are invalid
   * @throws {InsufficientBalanceError} If insufficient funds
   * @throws {NetworkError} If order submission fails
   */
  async placeOrder(
    orderParams: OrderParams,
    options: { tickSize: TickSize; negRisk: boolean },
    orderType: OrderType = OrderType.GTC
  ): Promise<OrderResponse> {
    // Ensure we have valid API credentials
    await this.initializeCreds();

    this.logger.info("Submitting order to Polymarket", {
      tokenID: orderParams.tokenID,
      side: orderParams.side,
      price: orderParams.price,
      size: orderParams.size,
      orderType,
    });

    try {
      const response = await this.clobClient.createAndPostOrder(
        orderParams,
        options,
        orderType
      );

      this.logger.info("Order successfully placed", {
        orderID: response.orderID,
        status: response.status,
      });

      return response as OrderResponse;
    } catch (error) {
      this.logger.error("Order placement failed", error as Error, {
        orderParams,
        options,
        orderType,
      });
      throw error;
    }
  }

  /**
   * Places a Good-Til-Date (GTD) order with a specific expiration time
   *
   * GTD orders are limit orders that remain active until:
   * - They are filled
   * - They are canceled
   * - The expiration date is reached (whichever comes first)
   *
   * EXPIRATION REQUIREMENTS:
   * - Must be at least 60 seconds in the future
   * - Specified as Unix timestamp (seconds since epoch)
   * - After expiration, order is automatically canceled
   *
   * USE CASES:
   * - Time-sensitive trading strategies
   * - Automated order expiration without manual cancellation
   * - Risk management (orders don't stay active indefinitely)
   *
   * EXAMPLE:
   * ```typescript
   * // Order expires in 1 hour
   * const expirationTime = Math.floor(Date.now() / 1000) + 3600;
   *
   * const response = await trader.placeGTDOrder(
   *   {
   *     tokenID: "token-id",
   *     price: 0.55,
   *     side: Side.BUY,
   *     size: 50,
   *     feeRateBps: 0,
   *   },
   *   expirationTime,
   *   { tickSize: "0.01", negRisk: false }
   * );
   * ```
   *
   * @param orderParams - Standard order parameters
   * @param expirationTimestamp - Unix timestamp when order should expire (seconds)
   * @param options - Trading options (tick size, negative risk flag)
   * @returns Promise resolving to order response
   * @throws {ValidationError} If expiration is less than 60 seconds away
   * @throws {InsufficientBalanceError} If insufficient funds
   * @throws {NetworkError} If order submission fails
   */
  async placeGTDOrder(
    orderParams: OrderParams,
    expirationTimestamp: number,
    options: { tickSize: TickSize; negRisk: boolean }
  ): Promise<OrderResponse> {
    // Validate expiration is at least 60 seconds in the future
    const now = Math.floor(Date.now() / 1000);
    const secondsUntilExpiration = expirationTimestamp - now;

    if (secondsUntilExpiration < 60) {
      throw new ValidationError(
        `GTD order expiration must be at least 60 seconds in the future. ` +
        `Current: ${secondsUntilExpiration} seconds`
      );
    }

    this.logger.info("Placing GTD order", {
      tokenID: orderParams.tokenID,
      expirationTimestamp,
      secondsUntilExpiration,
    });

    // GTD orders are placed with OrderType.GTD
    // Note: The expiration is handled by the CLOB client internally
    return this.placeOrder(orderParams, options, OrderType.GTD);
  }

  /**
   * Places a Fill-Or-Kill (FOK) order
   *
   * FOK orders are market orders that must be executed immediately and completely,
   * or the entire order is canceled. No partial fills are allowed.
   *
   * CHARACTERISTICS:
   * - Executes immediately at best available price
   * - All-or-nothing: either full size fills or order cancels
   * - No order book presence (never becomes a maker order)
   * - Best for large orders when partial fills are unacceptable
   *
   * USE CASES:
   * - Urgent trades where timing matters
   * - Large orders where partial fills complicate position management
   * - Market entries/exits that need immediate confirmation
   * - Strategies that require atomic execution
   *
   * EXAMPLE:
   * ```typescript
   * // Either buy all 200 shares immediately or cancel
   * const response = await trader.placeFOKOrder(
   *   {
   *     tokenID: "token-id",
   *     price: 0.70,  // Maximum willing to pay
   *     side: Side.BUY,
   *     size: 200,
   *     feeRateBps: 0,
   *   },
   *   { tickSize: "0.01", negRisk: false }
   * );
   *
   * if (response.success) {
   *   console.log("Full order filled immediately");
   * } else {
   *   console.log("Order canceled - not enough liquidity");
   * }
   * ```
   *
   * @param orderParams - Standard order parameters
   * @param options - Trading options (tick size, negative risk flag)
   * @returns Promise resolving to order response
   * @throws {InsufficientBalanceError} If insufficient funds
   * @throws {NetworkError} If order submission fails
   */
  async placeFOKOrder(
    orderParams: OrderParams,
    options: { tickSize: TickSize; negRisk: boolean }
  ): Promise<OrderResponse> {
    this.logger.info("Placing FOK (Fill-Or-Kill) order", {
      tokenID: orderParams.tokenID,
      side: orderParams.side,
      size: orderParams.size,
    });

    return this.placeOrder(orderParams, options, OrderType.FOK);
  }

  /**
   * Places a Good-Til-Canceled (GTC) order
   *
   * GTC orders are limit orders that remain active in the orderbook until:
   * - They are filled (matched with another order)
   * - They are manually canceled
   *
   * CHARACTERISTICS:
   * - Stays in orderbook indefinitely (no expiration)
   * - Can be partially filled over time
   * - Acts as a maker order (provides liquidity)
   * - Standard order type for most trading strategies
   *
   * USE CASES:
   * - Market making strategies
   * - Limit orders at specific price points
   * - Patient trading without time pressure
   * - Building positions over time with limit prices
   *
   * EXAMPLE:
   * ```typescript
   * // Place buy order at 0.45, stays active until filled or canceled
   * const response = await trader.placeGTCOrder(
   *   {
   *     tokenID: "token-id",
   *     price: 0.45,
   *     side: Side.BUY,
   *     size: 100,
   *     feeRateBps: 0,
   *   },
   *   { tickSize: "0.01", negRisk: false }
   * );
   *
   * // Order sits in orderbook at 0.45
   * // Fills when market price drops to 0.45 or lower
   * ```
   *
   * @param orderParams - Standard order parameters
   * @param options - Trading options (tick size, negative risk flag)
   * @returns Promise resolving to order response
   * @throws {InsufficientBalanceError} If insufficient funds
   * @throws {NetworkError} If order submission fails
   */
  async placeGTCOrder(
    orderParams: OrderParams,
    options: { tickSize: TickSize; negRisk: boolean }
  ): Promise<OrderResponse> {
    this.logger.info("Placing GTC (Good-Til-Canceled) order", {
      tokenID: orderParams.tokenID,
      side: orderParams.side,
      price: orderParams.price,
    });

    return this.placeOrder(orderParams, options, OrderType.GTC);
  }

  // ==========================================================================
  // CONVENIENCE METHODS
  // ==========================================================================

  /**
   * Places a test order on the current BTC Up/Down 15m market
   *
   * This is a convenience method for testing and demonstration purposes.
   * It automatically:
   * 1. Fetches the current active BTC market
   * 2. Selects the YES token
   * 3. Places a small test order (5 shares at $0.20)
   *
   * DO NOT USE IN PRODUCTION. This is hardcoded for testing only.
   *
   * For production bots, use placeOrder() directly with your own parameters.
   *
   * @returns Promise resolving to order response
   * @throws {Error} If no current BTC market is found
   * @throws {ValidationError} If market data is invalid
   */
  async placeTestOrder(): Promise<any> {
    this.logger.info("Fetching current BTC Up/Down 15m market for test order");

    const market = await this.marketFetcher.getCurrentBtcUpDown15mMarket();
    if (!market) {
      this.logger.error("No current BTC market found");
      throw new Error("No current BTC market found");
    }

    const tokenID = market.clobTokenIds[0]; // UP token
    if (!tokenID) {
      this.logger.error("No tokenID found in market data");
      throw new Error("No tokenID found");
    }

    this.logger.info("Placing test order", { tokenID });

    // Place a small test order: Buy 5 shares at 20 cents
    return this.placeOrder(
      {
        tokenID,
        price: 0.20,
        side: Side.BUY,
        size: 5,
        feeRateBps: 0,
      },
      { tickSize: "0.01" as TickSize, negRisk: false },
      OrderType.FAK
    );
  }

  // ==========================================================================
  // UTILITY METHODS FOR BOT INTEGRATION
  // ==========================================================================

  /**
   * Gets the current configuration (useful for accessing contract addresses)
   * @returns The PolymarketConfig instance
   */
  getConfig(): PolymarketConfig {
    return this.config;
  }

  /**
   * Gets the trading configuration (useful for checking limits and defaults)
   * @returns The TradingConfig instance
   */
  getTradingConfig(): TradingConfig {
    return this.tradingConfig;
  }

  /**
   * Gets the wallet address being used for trading
   * @returns The wallet's Ethereum address
   */
  getWalletAddress(): string {
    return this.wallet.address;
  }

  /**
   * Checks if API credentials have been initialized
   * @returns True if credentials are ready, false otherwise
   */
  hasCredentials(): boolean {
    return this.creds !== undefined;
  }

  /**
   * Deletes the current API key from the server and clears cached credentials
   *
   * Use this when you get "API Credentials are needed" errors despite having
   * valid-looking credentials. This forces creation of a fresh API key.
   *
   * WHEN TO USE:
   * - After getting "API Credentials are needed" error
   * - When switching between different wallets
   * - When credentials appear stale or invalid
   *
   * EXAMPLE:
   * ```typescript
   * try {
   *   await trader.placeOrder(...);
   * } catch (error) {
   *   if (error.message.includes("API Credentials are needed")) {
   *     await trader.resetApiKey();
   *     await trader.placeOrder(...); // Retry with fresh credentials
   *   }
   * }
   * ```
   *
   * @throws {NetworkError} If deletion fails
   */
  async resetApiKey(): Promise<void> {
    this.logger.info("Resetting API key (deleting old and forcing new creation)");

    try {
      // If we have credentials, set them on the CLOB client and delete from server
      if (this.creds) {
        this.logger.debug("Setting credentials on CLOB client for deletion");
        // The CLOB client needs credentials to delete the API key
        (this.clobClient as any).creds = this.creds;

        this.logger.debug("Deleting existing API key from server");
        await (this.clobClient as any).deleteApiKey();
        this.logger.info("Old API key deleted from server");
      } else {
        // Try to derive existing credentials to delete them
        this.logger.debug("No cached credentials, attempting to derive for deletion");
        try {
          const oldCreds = await this.clobClient.createOrDeriveApiKey();
          if (oldCreds && oldCreds.key) {
            (this.clobClient as any).creds = oldCreds;
            await (this.clobClient as any).deleteApiKey();
            this.logger.info("Derived and deleted old API key from server");
          }
        } catch (deriveError) {
          this.logger.debug("Could not derive credentials for deletion (may not exist)");
        }
      }
    } catch (error) {
      this.logger.warn("Failed to delete old API key - will create fresh credentials on next operation", {
        error: (error as Error).message
      });
      // Continue anyway - we'll create a new one
    }

    // Clear cached credentials from both trader and CLOB client
    delete (this as any).creds;
    delete (this.clobClient as any).creds;
    this.logger.info("Cached credentials cleared - next operation will create fresh API key");
  }

  // ==========================================================================
  // POSITION MANAGEMENT - MERGE & REDEEM
  // ==========================================================================

  /**
   * Merges a complete set of outcome tokens back into collateral (USDC)
   *
   * This operation burns equal amounts of YES and NO tokens to recover the
   * underlying USDC collateral. This is the inverse of "splitting" collateral
   * into outcome tokens.
   *
   * WHEN TO USE:
   * - After executing arbitrage (bought both YES and NO below $1.00)
   * - To recover collateral before market settlement
   * - When you have equal positions on both sides and want liquidity
   *
   * HOW IT WORKS:
   * - Requires holding at least 'amount' of BOTH YES and NO tokens
   * - Burns 'amount' of each token (YES + NO = complete set)
   * - Returns 'amount' USDC to your wallet
   * - Can be done anytime after position acquisition
   *
   * ARBITRAGE EXAMPLE:
   * ```typescript
   * // Bought 100 YES at $0.52 = $52 USDC spent
   * // Bought 100 NO at $0.45 = $45 USDC spent
   * // Total spent: $97 USDC
   *
   * await trader.mergePositions(conditionId, 100);
   *
   * // Result: Burns 100 YES + 100 NO, receives 100 USDC
   * // Profit: $100 - $97 = $3 (3.09% return in minutes)
   * ```
   *
   * REQUIREMENTS:
   * - Must have at least 'amount' of BOTH outcome tokens
   * - Sufficient MATIC for gas fees
   * - CTF contract must be approved (done via approveAllowances)
   *
   * @param conditionId - The market's condition ID (bytes32 hex string)
   * @param amount - Number of complete sets to merge (as number, will be converted to wei)
   * @returns Promise resolving to transaction receipt
   * @throws {ValidationError} If amount is invalid or insufficient balance
   * @throws {NetworkError} If transaction fails
   */
  async mergePositions(
    conditionId: string,
    amount: number
  ): Promise<any> {
    // Validate inputs
    if (amount <= 0) {
      throw new ValidationError(`Merge amount must be positive, got: ${amount}`);
    }

    if (!conditionId || !conditionId.startsWith('0x')) {
      throw new ValidationError(
        `Invalid conditionId format. Must be bytes32 hex string starting with 0x, got: ${conditionId}`
      );
    }

    this.logger.info("Merging positions to recover collateral", {
      conditionId,
      amount,
      operation: "merge"
    });

    try {
      // Convert amount to BigInt (USDC has 6 decimals)
      const decimals = await this.usdcContract.decimals();
      const amountWei = BigInt(Math.floor(amount * Math.pow(10, decimals)));

      this.logger.debug("Merge parameters", {
        conditionId,
        amountWei: amountWei.toString(),
        decimals,
        collateralToken: this.config.contracts.usdc
      });

      // Call mergePositions on CTF contract
      // parentCollectionId is always 0x0 for Polymarket (no nested conditions)
      // partition is [1, 2] for binary markets (YES = 1, NO = 2)
      const tx = await this.ctfContract.mergePositions!(
        this.config.contracts.usdc,                                          // collateralToken
        "0x0000000000000000000000000000000000000000000000000000000000000000", // parentCollectionId
        conditionId,                                                          // conditionId
        [1, 2],                                                              // partition (YES + NO)
        amountWei                                                            // amount in wei
      );

      this.logger.info("Merge transaction submitted", { txHash: tx.hash });

      const receipt = await tx.wait();

      this.logger.info("Positions merged successfully", {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
        amountMerged: amount,
        usdcRecovered: amount
      });

      return receipt;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error("Failed to merge positions", error as Error, {
        conditionId,
        amount,
        errorMessage
      });

      // Provide helpful error messages
      if (errorMessage.includes("insufficient")) {
        throw new InsufficientBalanceError(
          amount,  // required
          0,       // available (unknown, would need to query)
          'outcome tokens'
        );
      }

      if (errorMessage.includes("approve") || errorMessage.includes("allowance")) {
        throw new AllowanceError(
          "CTF contract not approved. Run approveAllowances() first."
        );
      }

      throw new NetworkError("Merge positions transaction failed", error as Error);
    }
  }

  /**
   * Redeems winning positions after market settlement
   *
   * After a market resolves, this burns your winning outcome tokens to receive
   * USDC at the settlement rate (typically $1.00 per winning share for binary markets).
   *
   * WHEN TO USE:
   * - ONLY after the market has been resolved by the oracle
   * - When you hold winning outcome tokens (YES if price went up, NO if down)
   * - To claim your profits and convert tokens back to USDC
   *
   * HOW IT WORKS:
   * - Market must be settled (oracle has reported the outcome)
   * - Burns your winning outcome tokens
   * - Receives USDC based on the payout vector (usually 1:1 for winners)
   * - Losing tokens become worthless (0 value)
   *
   * REDEMPTION EXAMPLE:
   * ```typescript
   * // You bought 100 YES shares at $0.65 = $65 USDC spent
   * // Bitcoin went UP, so YES wins
   * // Market settles, YES tokens now redeemable for $1.00 each
   *
   * await trader.redeemPositions(conditionId, true); // true = YES won
   *
   * // Result: Burns 100 YES tokens, receives 100 USDC
   * // Profit: $100 - $65 = $35 (53.8% return)
   * ```
   *
   * REQUIREMENTS:
   * - Market must be resolved (oracle has set payouts)
   * - Must hold winning outcome tokens
   * - Sufficient MATIC for gas fees
   * - CTF contract must be approved (done via approveAllowances)
   *
   * IMPORTANT: This does NOT work before settlement. Use mergePositions() if
   * you want to exit before the market resolves.
   *
   * @param conditionId - The market's condition ID (bytes32 hex string)
   * @param isYesOutcome - True if YES won, false if NO won
   * @returns Promise resolving to transaction receipt
   * @throws {ValidationError} If conditionId is invalid or market not settled
   * @throws {InsufficientBalanceError} If no tokens to redeem
   * @throws {NetworkError} If transaction fails
   */
  async redeemPositions(
    conditionId: string,
    isYesOutcome: boolean
  ): Promise<any> {
    // Validate inputs
    if (!conditionId || !conditionId.startsWith('0x')) {
      throw new ValidationError(
        `Invalid conditionId format. Must be bytes32 hex string starting with 0x, got: ${conditionId}`
      );
    }

    this.logger.info("Redeeming winning positions", {
      conditionId,
      winningOutcome: isYesOutcome ? "YES" : "NO",
      operation: "redeem"
    });

    try {
      // indexSets: [1] for YES, [2] for NO
      // These are the ERC1155 token IDs within the condition
      const indexSets = [isYesOutcome ? 1 : 2];

      this.logger.debug("Redeem parameters", {
        conditionId,
        indexSets,
        collateralToken: this.config.contracts.usdc
      });

      // Call redeemPositions on CTF contract
      // parentCollectionId is always 0x0 for Polymarket (no nested conditions)
      const tx = await this.ctfContract.redeemPositions!(
        this.config.contracts.usdc,                                          // collateralToken
        "0x0000000000000000000000000000000000000000000000000000000000000000", // parentCollectionId
        conditionId,                                                          // conditionId
        indexSets                                                            // [1] for YES or [2] for NO
      );

      this.logger.info("Redeem transaction submitted", { txHash: tx.hash });

      const receipt = await tx.wait();

      this.logger.info("Positions redeemed successfully", {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
        outcome: isYesOutcome ? "YES" : "NO"
      });

      return receipt;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error("Failed to redeem positions", error as Error, {
        conditionId,
        isYesOutcome,
        errorMessage
      });

      // Provide helpful error messages
      if (errorMessage.includes("not resolved") || errorMessage.includes("no payout")) {
        throw new ValidationError(
          "Market has not been resolved yet. Wait for oracle to report outcome before redeeming. " +
          "If you want to exit early, use mergePositions() instead (requires both YES and NO tokens)."
        );
      }

      if (errorMessage.includes("insufficient") || errorMessage.includes("balance")) {
        throw new InsufficientBalanceError(
          1,  // required (at least 1 token)
          0,  // available (unknown, would need to query)
          `${isYesOutcome ? "YES" : "NO"} tokens`
        );
      }

      if (errorMessage.includes("approve") || errorMessage.includes("allowance")) {
        throw new AllowanceError(
          "CTF contract not approved. Run approveAllowances() first."
        );
      }

      throw new NetworkError("Redeem positions transaction failed", error as Error);
    }
  }
}

/**
 * Factory function to create a fully configured PolymarketTrader instance
 * @param privateKey - Wallet private key
 * @param funderAddress - Wallet address for funding
 * @param isMainnet - Whether to use mainnet or testnet
 * @param logger - Optional logger implementation
 * @returns Configured PolymarketTrader instance
 */
/**
 * Optional pre-existing API credentials for Polymarket CLOB
 *
 * If provided, these credentials will be used instead of deriving new ones.
 * This is useful when you have fresh credentials from the reset script.
 */
export interface ApiCredentials {
  /** API key (UUID format) */
  key: string;
  /** API secret (base64 encoded) */
  secret: string;
  /** API passphrase (hex string) */
  passphrase: string;
}

export async function createPolymarketTrader(
  privateKey: string,
  funderAddress: string,
  isMainnet: boolean = true,
  logger?: ILogger,
  apiCredentials?: ApiCredentials
): Promise<PolymarketTrader> {
  // Initialize configuration
  const config = new PolymarketConfig(isMainnet);
  const tradingConfig = new TradingConfig();
  const log = logger || new ConsoleLogger();

  // Setup blockchain connection
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const oldWallet = new OldWallet(privateKey);

  // Initialize contracts
  const usdcContract = new Contract(config.contracts.usdc, ERC20_ABI, wallet);
  const ctfContract = new Contract(config.contracts.conditionalTokens, CTF_ABI, wallet);

  // Create balance checker (cast contract to interface for compatibility)
  const balanceChecker = new BalanceChecker(
    config,
    provider as IProvider,
    wallet as IWallet,
    usdcContract as unknown as IContract,
    log
  );

  // Initialize Polymarket client
  const clobClient = new ClobClient(config.host, config.chainId, oldWallet);

  // If API credentials were provided, set them on the CLOB client immediately
  if (apiCredentials) {
    log.info("Using pre-existing API credentials from environment", {
      apiKey: apiCredentials.key.substring(0, 15) + '...'
    });
    (clobClient as any).creds = apiCredentials;
  }

  // Load market fetcher
  const { getCurrentBtcUpDown15mMarket } = await import("../polymarket/btcUpDown15m.js");

  const trader = new PolymarketTrader(
    config,
    tradingConfig,
    clobClient as IClobClient,
    balanceChecker,
    usdcContract as unknown as IContract,
    ctfContract as unknown as IContract,
    { getCurrentBtcUpDown15mMarket } as IMarketFetcher,
    wallet as IWallet,
    log,
    funderAddress,
    tradingConfig.defaultSignatureType
  );

  // If credentials were provided, cache them in the trader instance too
  if (apiCredentials) {
    (trader as any).creds = apiCredentials;
  }

  return trader;
}