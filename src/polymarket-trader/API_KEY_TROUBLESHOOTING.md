# API Key Troubleshooting Guide

## The Problem

You're seeing this error:
```
[CLOB Client] request error {"status":400,"statusText":"Bad Request","data":{"error":"Could not create api key"}}
API Credentials are needed to interact with this endpoint!
```

## What's Happening

1. The CLOB client tries to create a new API key → Gets 400 error
2. It falls back to deriving an existing API key → Returns old credentials
3. The old credentials are stale/invalid → Order placement fails

This is a known issue with the Polymarket CLOB client when API keys become stale.

## The Solution

Run the fix script to reset your API key:

```bash
npx tsx src/test-trading/fix-api-key.ts
```

This script will:
1. ✅ Check your balance
2. 🔑 Delete your old API key from Polymarket
3. 🔐 Force creation of a fresh API key
4. 📝 Test it by placing a small order

## Manual Fix (Alternative)

If you prefer to fix it manually in your code:

```typescript
import { createPolymarketTrader } from './src/test-trading/PolymarketTrader.js';

const trader = await createPolymarketTrader(
  process.env.POLYMARKET_PRIVATE_KEY!,
  process.env.POLYMARKET_FUNDER_ADDRESS!,
  true  // mainnet
);

// Reset the API key
await trader.resetApiKey();

// Now place your order (this will create fresh credentials)
await trader.placeTestOrder();
```

## Root Causes

The "Could not create api key" error (400) can happen due to:

### 1. **Stale API Keys** (Most Common)
- Old API keys cached by the CLOB client
- Solution: Delete old key with `resetApiKey()`

### 2. **Insufficient Balance**
- Need at least $0.01 USDC in wallet
- Need MATIC for gas fees
- Solution: Bridge funds to Polygon

### 3. **Wrong Funder Address**
- Funder address must match your wallet address
- Check with: `trader.getWalletAddress()`
- Solution: Update `.env` file

### 4. **Allowances Not Set**
- USDC and CTF tokens need approval
- Solution: Run `trader.approveAllowances()`

## Verification Checklist

Before placing orders, verify:

```typescript
// ✅ Check balance
const balance = await trader.checkBalance();
console.log(`USDC: $${balance.usdc}`);  // Should be > 0
console.log(`MATIC: ${balance.matic}`);  // Should be > 0.1

// ✅ Check wallet matches funder
const wallet = trader.getWalletAddress();
console.log(`Wallet: ${wallet}`);
console.log(`Funder: ${process.env.POLYMARKET_FUNDER_ADDRESS}`);
// These should be identical

// ✅ Check allowances are approved
const config = trader.getConfig();
await trader.approveAllowances(
  config.contracts.conditionalTokens,
  config.contracts.exchange
);
```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Could not create api key" (400) | Stale credentials or setup issue | Run `resetApiKey()` |
| "API Credentials are needed" | Invalid/missing credentials | Run `resetApiKey()` |
| "Insufficient balance" | Not enough USDC | Bridge USDC to Polygon |
| "Invalid signature" | Wrong private key or funder | Check `.env` file |
| "not enough balance / allowance" | Allowances not set | Run `approveAllowances()` |

## Still Having Issues?

If the fix script doesn't work:

1. **Check Polymarket Server Status**
   - Visit https://polymarket.com
   - Check if the site is working normally

2. **Verify Network Connection**
   - Try accessing https://clob.polymarket.com in browser
   - Check for network restrictions/firewalls

3. **Check Transaction History**
   - View your wallet on Polygonscan: https://polygonscan.com/address/YOUR_ADDRESS
   - Verify recent transactions succeeded

4. **Try Testnet First**
   ```typescript
   const trader = await createPolymarketTrader(
     privateKey,
     funderAddress,
     false  // testnet instead of mainnet
   );
   ```

5. **Check for Market Availability**
   - Not all markets are available 24/7
   - BTC 15m markets have brief gaps between periods
   - Try a different market or wait a few minutes

## Prevention

To avoid API key issues in the future:

1. **Reset API key when switching wallets:**
   ```typescript
   await trader.resetApiKey();
   ```

2. **Handle credential errors gracefully:**
   ```typescript
   try {
     await trader.placeOrder(params, options);
   } catch (error) {
     if (error.message.includes("API Credentials")) {
       await trader.resetApiKey();
       await trader.placeOrder(params, options);  // Retry
     }
   }
   ```

3. **Don't reuse trader instances across sessions:**
   - Create a fresh trader instance for each trading session
   - Don't cache the trader object long-term

## Technical Details

The API key system works like this:

1. **L1 Auth**: Your wallet signs an EIP-712 message to prove ownership
2. **API Key Creation**: Polymarket returns: apiKey, secret, passphrase
3. **L2 Auth**: Subsequent requests use HMAC-SHA256 with these credentials

When you get a 400 error on key creation, it means:
- The server rejected your L1 authentication
- An old API key exists and cannot be overwritten
- You need to delete the old key first

The `createOrDeriveApiKey()` method:
- First tries `createApiKey()` (POST /auth/api-key)
- On failure, falls back to `deriveApiKey()` (GET /auth/derive-api-key)
- The derived key might be stale if it's old

The `resetApiKey()` method:
- Calls `deleteApiKey()` (DELETE /auth/api-key)
- Clears cached credentials
- Forces fresh creation on next operation

## References

- [Polymarket CLOB Docs](https://docs.polymarket.com/developers/CLOB/introduction)
- [Authentication Guide](https://docs.polymarket.com/developers/CLOB/authentication)
- [Error Codes](https://docs.polymarket.com/developers/CLOB/errors)
