#!/usr/bin/env tsx

// Test script using the PolymarketTrader class
// This replaces the old testOrder.ts with a cleaner implementation

import { createPolymarketTrader } from './PolymarketTrader.js';
import type { ApiCredentials } from './PolymarketTrader.js';
import { Side, OrderType } from "@polymarket/clob-client";
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from project root
config({ path: path.resolve(__dirname, '../../.env') });

const host = 'https://clob.polymarket.com';
const chainId = 137; // Polygon mainnet

// Load from environment variables
const privateKey = process.env.POLYMARKET_PRIVATE_KEY!;
const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS!;

// Load API credentials if available (from the reset script)
const apiKey = process.env.POLYMARKET_API_KEY || process.env.apiKey;
const apiSecret = process.env.POLYMARKET_API_SECRET || process.env.secret;
const apiPassphrase = process.env.POLYMARKET_API_PASSPHRASE || process.env.passPhrase;

if (!privateKey || !funderAddress) {
  console.error('❌ Please set POLYMARKET_PRIVATE_KEY and POLYMARKET_FUNDER_ADDRESS in .env file');
  process.exit(1);
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let token = 'up'; // default
  let shares = 5; // default
  let price = 0.20; // default

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && i + 1 < args.length) {
      token = args[i + 1]!.toLowerCase();
      i++;
    } else if (args[i] === '--shares' && i + 1 < args.length) {
      const sharesStr = args[i + 1]!;
      const parsed = parseInt(sharesStr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        shares = parsed;
      } else {
        console.error('❌ Invalid shares value');
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--price' && i + 1 < args.length) {
      const priceStr = args[i + 1]!;
      const parsed = parseFloat(priceStr);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 0.99) {
        price = parsed;
      } else {
        console.error('❌ Invalid price value (must be between 0.01 and 0.99)');
        process.exit(1);
      }
      i++;
    }
  }

  if (token !== 'up' && token !== 'down') {
    console.error('❌ Invalid token. Use --token up or --token down');
    process.exit(1);
  }

  try {
    // Prepare API credentials if available
    let apiCredentials: ApiCredentials | undefined;
    if (apiKey && apiSecret && apiPassphrase) {
      apiCredentials = {
        key: apiKey,
        secret: apiSecret,
        passphrase: apiPassphrase
      };
    }

    // Create trader instance with API credentials
    const trader = await createPolymarketTrader(
      privateKey,
      funderAddress,
      true, // mainnet
      undefined, // use default logger
      apiCredentials
    );

    // Check balances
    const balance = await trader.checkBalance();

    // Check if we can afford the test order
    const testOrderCost = shares * price; // shares at specified price each

    if (balance.usdc < testOrderCost) {
      console.error(`❌ Insufficient USDC balance!`);
      console.error(`   Required: ${testOrderCost.toFixed(2)} USDC`);
      console.error(`   Available: ${balance.usdc.toFixed(2)} USDC`);
      console.error(`💡 Please bridge USDC to Polygon and try again.`);
      return;
    }

    // Approve allowances (if needed)
    await trader.approveAllowances(
      '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045', // Conditional Tokens Framework
      '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'  // Exchange
    );

    // Fetch current BTC Up/Down 15m market
    const { getCurrentBtcUpDown15mMarket } = await import('../polymarket/btcUpDown15m.js');
    const market = await getCurrentBtcUpDown15mMarket();
    if (!market) {
      throw new Error('No current BTC market found');
    }

    const tokenIndex = token === 'up' ? 0 : 1;
    const tokenID = market.clobTokenIds[tokenIndex];
    if (!tokenID) {
      throw new Error(`No ${token} tokenID found`);
    }

    // Place test order
    const orderResult = await trader.placeOrder(
      {
        tokenID,
        price: price,
        side: Side.BUY,
        size: shares,
        feeRateBps: 0,
      },
      { tickSize: '0.01' as any, negRisk: false },
      OrderType.FAK
    );

    console.log('✅ Test order placed successfully!');
    console.log('📋 Order Result:', JSON.stringify(orderResult, null, 2));

    // Final balance check
    const finalBalance = await trader.checkBalance();
    console.log(`💰 Final USDC: ${finalBalance.usdc.toFixed(2)} USDC`);
    console.log(`⛽ Final MATIC: ${finalBalance.matic.toFixed(4)} MATIC`);

    const usdSpent = balance.usdc - finalBalance.usdc;
    console.log(`💸 USDC spent: ${usdSpent.toFixed(2)} USDC`);

  } catch (error) {
    console.error('❌ Error during testing:', error);

    // Provide helpful troubleshooting based on error type
    if (error instanceof Error) {
      if (error.message.includes('insufficient funds')) {
        console.log('💡 This usually means you need more MATIC for gas fees');
      } else if (error.message.includes('allowance')) {
        console.log('💡 Try running the approval step again');
      } else if (error.message.includes('signature')) {
        console.log('💡 Check that your private key matches the funder address');
      }
    }

    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Test interrupted by user');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});