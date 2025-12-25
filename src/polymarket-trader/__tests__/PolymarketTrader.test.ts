/**
 * Unit tests for PolymarketTrader
 *
 * These tests verify the core trading functionality using mocked dependencies.
 * All external dependencies (blockchain, API, contracts) are mocked to enable
 * fast, reliable testing without network calls.
 */

import { PolymarketTrader } from '../PolymarketTrader.js';
import type {
  IClobClient,
  IWallet,
  IContract,
  IMarketFetcher,
  IBalanceChecker,
  BalanceInfo,
} from '../PolymarketTrader.js';
import { PolymarketConfig, TradingConfig } from '../PolymarketConfig.js';
import { OrderType, Side } from '@polymarket/clob-client';
import type { ApiKeyCreds, TickSize } from '@polymarket/clob-client';
import { NoOpLogger } from '../Logger.js';

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

/**
 * Mock CLOB client for testing order placement
 */
const mockClobClient: jest.Mocked<IClobClient> = {
  createOrDeriveApiKey: jest.fn(),
  createAndPostOrder: jest.fn(),
};

/**
 * Mock wallet with test address
 */
const mockWallet: jest.Mocked<IWallet> = {
  address: '0x1234567890123456789012345678901234567890',
};

/**
 * Mock USDC contract for balance and allowance checks
 */
const mockUsdcContract: jest.Mocked<IContract> = {
  allowance: jest.fn(),
  approve: jest.fn(),
  isApprovedForAll: jest.fn(),
  setApprovalForAll: jest.fn(),
  balanceOf: jest.fn(),
  decimals: jest.fn(),
  symbol: jest.fn(),
};

/**
 * Mock CTF contract for position token approvals
 */
const mockCtfContract: jest.Mocked<IContract> = {
  allowance: jest.fn(),
  approve: jest.fn(),
  isApprovedForAll: jest.fn(),
  setApprovalForAll: jest.fn(),
  balanceOf: jest.fn(),
  decimals: jest.fn(),
  symbol: jest.fn(),
};

/**
 * Mock market fetcher for test markets
 */
const mockMarketFetcher: jest.Mocked<IMarketFetcher> = {
  getCurrentBtcUpDown15mMarket: jest.fn(),
};

/**
 * Mock balance checker for wallet balance queries
 */
const mockBalanceChecker: jest.Mocked<IBalanceChecker> = {
  checkBalance: jest.fn(),
};

// ============================================================================
// TEST SUITE
// ============================================================================

describe('PolymarketTrader', () => {
  let trader: PolymarketTrader;
  let config: PolymarketConfig;
  let tradingConfig: TradingConfig;

  /**
   * Setup before each test - creates fresh instances and resets mocks
   */
  beforeEach(() => {
    // Clear all mock call history
    jest.clearAllMocks();

    // Create test configuration (using testnet)
    config = new PolymarketConfig(false);
    tradingConfig = new TradingConfig();

    // Create trader instance with all mocked dependencies
    trader = new PolymarketTrader(
      config,
      tradingConfig,
      mockClobClient,
      mockBalanceChecker,
      mockUsdcContract,
      mockCtfContract,
      mockMarketFetcher,
      mockWallet,
      new NoOpLogger(), // Silent logger for tests
      '0x1234567890123456789012345678901234567890', // funder address
      0 // signature type
    );
  });

  // ==========================================================================
  // BALANCE CHECKING TESTS
  // ==========================================================================

  describe('checkBalance', () => {
    it('should return USDC and MATIC balances from balance checker', async () => {
      // Arrange: Mock balance checker to return test balances
      const mockBalances: BalanceInfo = {
        usdc: 100.50,
        matic: 5.25,
      };
      mockBalanceChecker.checkBalance.mockResolvedValue(mockBalances);

      // Act: Call checkBalance
      const result = await trader.checkBalance();

      // Assert: Verify correct balances returned
      expect(result.usdc).toBe(100.50);
      expect(result.matic).toBe(5.25);
      expect(mockBalanceChecker.checkBalance).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from balance checker', async () => {
      // Arrange: Mock balance checker to throw error
      const testError = new Error('Network timeout');
      mockBalanceChecker.checkBalance.mockRejectedValue(testError);

      // Act & Assert: Verify error is propagated
      await expect(trader.checkBalance()).rejects.toThrow('Network timeout');
    });
  });

  // ==========================================================================
  // ALLOWANCE APPROVAL TESTS
  // ==========================================================================

  describe('approveAllowances', () => {
    it('should approve USDC for Conditional Tokens when allowance is 0', async () => {
      // Arrange: Mock zero allowances
      mockUsdcContract.allowance.mockResolvedValue(BigInt(0));
      mockCtfContract.isApprovedForAll.mockResolvedValue(false);

      // Mock successful transactions
      const mockTx = {
        hash: '0xabcdef123456',
        wait: jest.fn().mockResolvedValue({}),
      };
      mockUsdcContract.approve.mockResolvedValue(mockTx);
      mockCtfContract.setApprovalForAll.mockResolvedValue(mockTx);

      // Act: Approve all allowances
      await trader.approveAllowances(
        config.contracts.conditionalTokens,
        config.contracts.exchange
      );

      // Assert: Verify all approvals were called
      expect(mockUsdcContract.approve).toHaveBeenCalledTimes(2); // CTF + Exchange
      expect(mockCtfContract.setApprovalForAll).toHaveBeenCalledTimes(1);
      expect(mockUsdcContract.approve).toHaveBeenCalledWith(
        config.contracts.conditionalTokens,
        expect.anything() // MaxUint256
      );
      expect(mockUsdcContract.approve).toHaveBeenCalledWith(
        config.contracts.exchange,
        expect.anything() // MaxUint256
      );
      expect(mockCtfContract.setApprovalForAll).toHaveBeenCalledWith(
        config.contracts.exchange,
        true
      );
    });

    it('should skip approval when allowance already exists', async () => {
      // Arrange: Mock existing allowances
      mockUsdcContract.allowance.mockResolvedValue(BigInt(1000000)); // Non-zero
      mockCtfContract.isApprovedForAll.mockResolvedValue(true);

      // Act: Try to approve (should skip)
      await trader.approveAllowances(
        config.contracts.conditionalTokens,
        config.contracts.exchange
      );

      // Assert: Verify no approval transactions were sent
      expect(mockUsdcContract.approve).not.toHaveBeenCalled();
      expect(mockCtfContract.setApprovalForAll).not.toHaveBeenCalled();
    });

    it('should handle approval transaction failures', async () => {
      // Arrange: Mock approval failure
      mockUsdcContract.allowance.mockResolvedValue(BigInt(0));
      mockUsdcContract.approve.mockRejectedValue(new Error('Transaction reverted'));

      // Act & Assert: Verify error is thrown
      await expect(
        trader.approveAllowances(
          config.contracts.conditionalTokens,
          config.contracts.exchange
        )
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // ORDER PLACEMENT TESTS
  // ==========================================================================

  describe('placeOrder', () => {
    it('should create API key on first order', async () => {
      // Arrange: Mock API key creation
      const mockCreds: ApiKeyCreds = {
        key: 'test-key',
        secret: 'test-secret',
        passphrase: 'test-pass',
      };
      mockClobClient.createOrDeriveApiKey.mockResolvedValue(mockCreds);
      mockClobClient.createAndPostOrder.mockResolvedValue({
        orderID: 'order-123',
        status: 'live',
      });

      // Act: Place order
      const orderParams = {
        tokenID: 'token-123',
        price: 0.65,
        side: Side.BUY,
        size: 10,
        feeRateBps: 0,
      };
      const options = { tickSize: '0.01' as TickSize, negRisk: false };

      const result = await trader.placeOrder(orderParams, options, OrderType.GTC);

      // Assert: Verify API key created and order placed
      expect(mockClobClient.createOrDeriveApiKey).toHaveBeenCalledTimes(1);
      expect(mockClobClient.createAndPostOrder).toHaveBeenCalledWith(
        orderParams,
        options,
        OrderType.GTC
      );
      expect(result.orderID).toBe('order-123');
    });

    it('should reuse API credentials for subsequent orders', async () => {
      // Arrange: Mock API key creation
      const mockCreds: ApiKeyCreds = {
        key: 'test-key',
        secret: 'test-secret',
        passphrase: 'test-pass',
      };
      mockClobClient.createOrDeriveApiKey.mockResolvedValue(mockCreds);
      mockClobClient.createAndPostOrder.mockResolvedValue({
        orderID: 'order-123',
        status: 'live',
      });

      // Act: Place two orders
      const orderParams1 = {
        tokenID: 'token-123',
        price: 0.50,
        side: Side.BUY,
        size: 10,
        feeRateBps: 0,
      };
      const orderParams2 = {
        tokenID: 'token-456',
        price: 0.60,
        side: Side.SELL,
        size: 5,
        feeRateBps: 0,
      };
      const options = { tickSize: '0.01' as TickSize, negRisk: false };

      await trader.placeOrder(orderParams1, options);
      await trader.placeOrder(orderParams2, options);

      // Assert: API key created only once
      expect(mockClobClient.createOrDeriveApiKey).toHaveBeenCalledTimes(1);
      expect(mockClobClient.createAndPostOrder).toHaveBeenCalledTimes(2);
    });

    it('should handle order placement failures', async () => {
      // Arrange: Mock order failure
      mockClobClient.createOrDeriveApiKey.mockResolvedValue({
        key: 'test-key',
        secret: 'test-secret',
        passphrase: 'test-pass',
      });
      mockClobClient.createAndPostOrder.mockRejectedValue(
        new Error('Insufficient balance')
      );

      // Act & Assert: Verify error is propagated
      const orderParams = {
        tokenID: 'token-123',
        price: 0.50,
        side: Side.BUY,
        size: 1000,
        feeRateBps: 0,
      };
      const options = { tickSize: '0.01' as TickSize, negRisk: false };

      await expect(trader.placeOrder(orderParams, options)).rejects.toThrow(
        'Insufficient balance'
      );
    });
  });

  // ==========================================================================
  // TEST ORDER PLACEMENT TESTS
  // ==========================================================================

  describe('placeTestOrder', () => {
    it('should place test order for BTC market', async () => {
      // Arrange: Mock market and order placement
      mockMarketFetcher.getCurrentBtcUpDown15mMarket.mockResolvedValue({
        clobTokenIds: ['yes-token-id', 'no-token-id'],
      });
      mockClobClient.createOrDeriveApiKey.mockResolvedValue({
        key: 'test-key',
        secret: 'test-secret',
        passphrase: 'test-pass',
      });
      mockClobClient.createAndPostOrder.mockResolvedValue({
        orderID: 'test-order-123',
        status: 'live',
      });

      // Act: Place test order
      const result = await trader.placeTestOrder();

      // Assert: Verify correct token and parameters used
      expect(mockMarketFetcher.getCurrentBtcUpDown15mMarket).toHaveBeenCalled();
      expect(mockClobClient.createAndPostOrder).toHaveBeenCalledWith(
        {
          tokenID: 'yes-token-id', // First token (YES)
          price: 0.20,
          side: Side.BUY,
          size: 5,
          feeRateBps: 0,
        },
        { tickSize: '0.01' as TickSize, negRisk: false },
        OrderType.GTC
      );
      expect(result.orderID).toBe('test-order-123');
    });

    it('should throw error when no market found', async () => {
      // Arrange: Mock no market available
      mockMarketFetcher.getCurrentBtcUpDown15mMarket.mockResolvedValue(null);

      // Act & Assert: Verify error is thrown
      await expect(trader.placeTestOrder()).rejects.toThrow('No current BTC market found');
    });

    it('should throw error when token IDs are missing', async () => {
      // Arrange: Mock market with empty token array
      mockMarketFetcher.getCurrentBtcUpDown15mMarket.mockResolvedValue({
        clobTokenIds: [] as any,
      });

      // Act & Assert: Verify error is thrown
      await expect(trader.placeTestOrder()).rejects.toThrow('No tokenID found');
    });
  });

  // ==========================================================================
  // UTILITY METHOD TESTS
  // ==========================================================================

  describe('utility methods', () => {
    it('should return configuration via getConfig', () => {
      const returnedConfig = trader.getConfig();
      expect(returnedConfig).toBe(config);
    });

    it('should return trading config via getTradingConfig', () => {
      const returnedTradingConfig = trader.getTradingConfig();
      expect(returnedTradingConfig).toBe(tradingConfig);
    });

    it('should return wallet address via getWalletAddress', () => {
      const address = trader.getWalletAddress();
      expect(address).toBe(mockWallet.address);
    });

    it('should return false for hasCredentials before initialization', () => {
      expect(trader.hasCredentials()).toBe(false);
    });

    it('should return true for hasCredentials after initialization', async () => {
      // Arrange: Mock credential creation
      mockClobClient.createOrDeriveApiKey.mockResolvedValue({
        key: 'test-key',
        secret: 'test-secret',
        passphrase: 'test-pass',
      });

      // Act: Initialize credentials
      await trader.initializeCreds();

      // Assert: Credentials now exist
      expect(trader.hasCredentials()).toBe(true);
    });
  });
});
