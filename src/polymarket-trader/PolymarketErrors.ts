/**
 * Custom error classes for Polymarket trading operations
 *
 * These error types enable precise error handling in trading bots:
 * - Catch specific errors to implement retry logic
 * - Log errors with appropriate severity
 * - Provide detailed context for debugging
 * - Enable automated error recovery strategies
 *
 * USAGE PATTERN:
 * ```typescript
 * try {
 *   await trader.placeOrder(...);
 * } catch (error) {
 *   if (error instanceof InsufficientBalanceError) {
 *     // Pause trading, send alert, wait for funding
 *   } else if (error instanceof NetworkError) {
 *     // Retry with exponential backoff
 *   } else if (error instanceof ValidationError) {
 *     // Log and skip - bad order parameters
 *   }
 * }
 * ```
 */

/**
 * Base error class for all Polymarket trading errors
 *
 * All custom errors extend this class, allowing you to catch
 * any trading-related error with `instanceof PolymarketError`.
 *
 * Includes an error code for programmatic error handling.
 */
export class PolymarketError extends Error {
  /**
   * Creates a new PolymarketError
   * @param message - Human-readable error description
   * @param code - Machine-readable error code (e.g., 'INSUFFICIENT_BALANCE')
   */
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'PolymarketError';
    // Maintains proper stack trace for where error was thrown (V8 engines only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when wallet has insufficient token balance for an operation
 *
 * WHEN THROWN:
 * - Trying to place an order larger than USDC balance
 * - Insufficient MATIC for gas fees
 * - Trying to sell more shares than owned
 *
 * RECOVERY STRATEGIES:
 * - Wait for funding to arrive
 * - Reduce order size automatically
 * - Switch to a different funded wallet
 * - Send notification to operator
 *
 * @example
 * ```typescript
 * if (orderCost > balance.usdc) {
 *   throw new InsufficientBalanceError(orderCost, balance.usdc, 'USDC');
 * }
 * ```
 */
export class InsufficientBalanceError extends PolymarketError {
  /**
   * Creates a new InsufficientBalanceError
   * @param required - Amount needed for the operation
   * @param available - Amount currently available
   * @param token - Token symbol (default: 'USDC')
   */
  constructor(
    public readonly required: number,
    public readonly available: number,
    public readonly token: string = 'USDC'
  ) {
    super(
      `Insufficient ${token} balance. Required: ${required.toFixed(6)}, Available: ${available.toFixed(6)}`,
      'INSUFFICIENT_BALANCE'
    );
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Error thrown when token allowance/approval operations fail
 *
 * WHEN THROWN:
 * - Setting USDC allowance for contracts fails
 * - Setting CTF operator approval fails
 * - Transaction is rejected or reverts
 *
 * RECOVERY STRATEGIES:
 * - Check if user has enough MATIC for gas
 * - Retry the approval transaction
 * - Verify contract addresses are correct
 * - Check if wallet is the actual owner
 *
 * @example
 * ```typescript
 * try {
 *   await usdcContract.approve(spender, amount);
 * } catch (error) {
 *   throw new AllowanceError('Failed to approve USDC spending');
 * }
 * ```
 */
export class AllowanceError extends PolymarketError {
  /**
   * Creates a new AllowanceError
   * @param message - Description of the allowance failure
   */
  constructor(message: string) {
    super(message, 'ALLOWANCE_ERROR');
    this.name = 'AllowanceError';
  }
}

/**
 * Error thrown when network/RPC operations fail
 *
 * WHEN THROWN:
 * - RPC endpoint is unreachable
 * - Transaction broadcast fails
 * - Balance check times out
 * - API rate limits hit
 * - Blockchain reorg detected
 *
 * RECOVERY STRATEGIES:
 * - Retry with exponential backoff
 * - Switch to backup RPC endpoint
 * - Wait for network congestion to clear
 * - Implement circuit breaker pattern
 *
 * The original error is preserved for debugging and detailed logging.
 *
 * @example
 * ```typescript
 * try {
 *   await provider.getBalance(address);
 * } catch (error) {
 *   throw new NetworkError('Balance check failed', error);
 * }
 * ```
 */
export class NetworkError extends PolymarketError {
  /**
   * Creates a new NetworkError
   * @param message - High-level description of the failure
   * @param originalError - The underlying error that caused the network failure
   */
  constructor(message: string, public readonly originalError?: Error) {
    // Include original error message in the main message for better context
    const fullMessage = originalError
      ? `Network error: ${message} (${originalError.message})`
      : `Network error: ${message}`;

    super(fullMessage, 'NETWORK_ERROR');
    this.name = 'NetworkError';

    // Preserve the original stack trace if available
    if (originalError?.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }
}

/**
 * Error thrown when input validation fails
 *
 * WHEN THROWN:
 * - Order price is out of range (not between 0.01 and 0.99)
 * - Order size is below minimum
 * - Token ID is invalid format
 * - Invalid Ethereum address provided
 * - Missing required parameters
 *
 * RECOVERY STRATEGIES:
 * - Log and skip the invalid order
 * - Fix the validation logic in the bot
 * - Adjust parameters to valid ranges
 * - Alert developer about data quality issues
 *
 * @example
 * ```typescript
 * if (price < 0.01 || price > 0.99) {
 *   throw new ValidationError(`Price ${price} is out of range [0.01, 0.99]`);
 * }
 * ```
 */
export class ValidationError extends PolymarketError {
  /**
   * Creates a new ValidationError
   * @param message - Description of what validation failed and why
   */
  constructor(message: string) {
    super(`Validation error: ${message}`, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when market data operations fail
 *
 * WHEN THROWN:
 * - Market fetching from API fails
 * - Market data is malformed or incomplete
 * - No active markets found
 * - Market has been closed/resolved
 * - Token IDs are missing from market data
 *
 * RECOVERY STRATEGIES:
 * - Retry market data fetch
 * - Switch to backup data source
 * - Wait for market to become available
 * - Skip this market and try the next one
 *
 * @example
 * ```typescript
 * const market = await fetchMarket(marketId);
 * if (!market || !market.clobTokenIds) {
 *   throw new MarketDataError(`Invalid market data for ${marketId}`);
 * }
 * ```
 */
export class MarketDataError extends PolymarketError {
  /**
   * Creates a new MarketDataError
   * @param message - Description of the market data issue
   */
  constructor(message: string) {
    super(`Market data error: ${message}`, 'MARKET_DATA_ERROR');
    this.name = 'MarketDataError';
  }
}