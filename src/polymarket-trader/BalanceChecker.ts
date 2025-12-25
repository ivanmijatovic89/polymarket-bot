import { formatUnits } from 'ethers';
import type { PolymarketConfig } from './PolymarketConfig.js';
import type { ILogger } from './Logger.js';
import type { IProvider, IWallet, IContract } from './PolymarketTrader.js';
import { NetworkError } from './PolymarketErrors.js';

/**
 * Balance information for a trading account
 *
 * Contains the current token balances needed for trading:
 * - USDC: Used to buy prediction market shares
 * - MATIC: Used to pay gas fees for blockchain transactions
 */
export interface BalanceInfo {
  /** USDC balance in dollars (e.g., 100.50 = $100.50) */
  usdc: number;
  /** MATIC balance in tokens (e.g., 2.5 = 2.5 MATIC) */
  matic: number;
}

/**
 * Interface for balance checking operations
 *
 * Abstraction layer for balance checks, enabling:
 * - Easy mocking in tests
 * - Alternative implementations (cached balances, off-chain tracking, etc.)
 * - Consistent interface across different wallet types
 */
export interface IBalanceChecker {
  /**
   * Checks current USDC and MATIC balances for the trading wallet
   *
   * This queries the blockchain to get real-time balances.
   * MATIC is the native token, USDC is checked via the ERC20 contract.
   *
   * @returns Promise resolving to balance information
   * @throws {NetworkError} If balance check fails due to network issues
   */
  checkBalance(): Promise<BalanceInfo>;
}

/**
 * Service for checking wallet balances on the Polygon network
 *
 * Queries blockchain state to retrieve:
 * - Native MATIC balance (for gas fees)
 * - USDC token balance (for trading)
 *
 * INTEGRATION TIPS:
 * - Call this before placing orders to ensure sufficient funds
 * - Monitor MATIC balance - you need it for approvals and trades
 * - Consider caching results briefly to reduce RPC calls
 * - Set up alerts when balances drop below operational thresholds
 *
 * COST: This makes 4 RPC calls per check:
 * 1. getBalance (for MATIC)
 * 2. usdcContract.balanceOf (for USDC amount)
 * 3. usdcContract.decimals (for formatting, usually cached by RPC)
 * 4. usdcContract.symbol (for display, usually cached by RPC)
 */
export class BalanceChecker implements IBalanceChecker {
  /** Number of decimals for MATIC token (always 18) */
  private static readonly MATIC_DECIMALS = 18;

  /** Minimum MATIC balance for basic operations (in MATIC tokens) */
  private static readonly MIN_MATIC_WARNING_THRESHOLD = 0.1;

  /**
   * Creates a new BalanceChecker instance
   *
   * @param config - Network configuration (mainnet vs testnet)
   * @param provider - RPC provider for blockchain queries
   * @param wallet - Wallet to check balances for
   * @param usdcContract - USDC token contract instance
   * @param logger - Logger for operation tracking
   */
  constructor(
    private readonly config: PolymarketConfig,
    private readonly provider: IProvider,
    private readonly wallet: IWallet,
    private readonly usdcContract: IContract,
    private readonly logger: ILogger
  ) {}

  /**
   * Checks current USDC and MATIC balances
   *
   * Queries the blockchain for:
   * 1. Native MATIC balance (via provider.getBalance)
   * 2. USDC token balance (via USDC contract)
   *
   * Results are formatted to human-readable numbers:
   * - USDC: Decimal value in dollars (e.g., 123.45)
   * - MATIC: Decimal value in tokens (e.g., 5.2)
   *
   * WARNINGS:
   * - If USDC is 0, logs a warning about bridging funds
   * - If MATIC is low, warns about insufficient gas
   *
   * @returns Balance information with formatted values
   * @throws {NetworkError} If any balance query fails
   */
  async checkBalance(): Promise<BalanceInfo> {
    this.logger.info(`Checking balances for wallet ${this.wallet.address}`);

    try {
      // -----------------------------------------------------------------------
      // Check MATIC balance (native token used for gas fees)
      // -----------------------------------------------------------------------
      this.logger.debug('Querying MATIC balance');
      const maticBalance = await this.provider.getBalance(this.wallet.address);
      // Convert from wei (1e18) to MATIC tokens
      const matic = parseFloat(formatUnits(maticBalance, BalanceChecker.MATIC_DECIMALS));

      // -----------------------------------------------------------------------
      // Check USDC balance (ERC20 token used for trading)
      // -----------------------------------------------------------------------
      this.logger.debug('Querying USDC balance');
      const usdcBalance = await this.usdcContract.balanceOf(this.wallet.address);

      // Get token decimals for proper formatting (USDC uses 6 decimals)
      const decimals = await this.usdcContract.decimals();
      const symbol = await this.usdcContract.symbol();

      // Convert from smallest unit to decimal (e.g., 1000000 -> 1.00 USDC)
      const usdc = parseFloat(formatUnits(usdcBalance, decimals));

      // Log formatted balances
      this.logger.info(
        `Balance check complete - ${symbol}: $${usdc.toFixed(2)}, MATIC: ${matic.toFixed(4)}`
      );

      // -----------------------------------------------------------------------
      // Balance warnings for operational issues
      // -----------------------------------------------------------------------

      // Warn if no USDC available for trading
      if (usdc === 0) {
        this.logger.warn(
          'No USDC balance detected. Bridge USDC from Ethereum mainnet to Polygon to start trading.'
        );
      }

      // Warn if MATIC is too low to pay gas fees
      if (matic < BalanceChecker.MIN_MATIC_WARNING_THRESHOLD) {
        this.logger.warn(
          `Low MATIC balance (${matic.toFixed(4)}). You may not have enough for gas fees. ` +
          `Consider adding more MATIC to continue trading.`
        );
      }

      return { usdc, matic };

    } catch (error) {
      this.logger.error('Balance check failed', error as Error, {
        walletAddress: this.wallet.address,
        network: this.config.networkName,
      });
      throw new NetworkError('Balance check failed', error as Error);
    }
  }
}