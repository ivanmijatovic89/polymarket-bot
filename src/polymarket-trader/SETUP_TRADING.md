# Polymarket Trading Setup Guide

## Prerequisites

1. **Wallet with funds**: You need a wallet with:
   - USDC on Polygon network (for buying)
   - MATIC for gas fees (small amount, ~0.1 MATIC is enough)

2. **Private key and funder address**:
   - For email/Magic login: Export from https://reveal.magic.link/polymarket
   - For MetaMask: Export from your wallet settings
   - Funder address: The address shown below your profile picture on Polymarket

## Step 1: Configure Environment Variables

Add these to your `.env` file:

```bash
POLYMARKET_PRIVATE_KEY=your_private_key_here
POLYMARKET_FUNDER_ADDRESS=your_funder_address_here
```

**Security Warning**: Never commit your `.env` file to git! Make sure it's in `.gitignore`.

## Step 2: Approve USDC Allowances

Before placing your first order, you need to approve the Polymarket contracts to spend your USDC:

```bash
npm run tsx approveAllowances.ts
```

This will:
- Approve USDC for Conditional Tokens contract
- Approve USDC for Exchange contract
- Approve Conditional Tokens for Exchange contract

You only need to run this **once** per wallet. The approvals are unlimited and persist.

**Note**: Each approval requires a small gas fee (~$0.01-0.10 in MATIC).

## Step 3: Test Order Placement

Once allowances are set, test placing an order:

```bash
npm run tsx testOrder.ts
```

This will:
1. Create/derive API credentials
2. Fetch current BTC 15-min market
3. Place a test order (BUY 5 shares at $0.20)

## Understanding Signature Types

The code uses `signatureType = 1`:
- **0**: Browser Wallet (MetaMask, Coinbase Wallet, etc)
- **1**: Magic/Email Login
- **2**: (Documented but usage unclear)

## Common Errors

### "not enough balance / allowance"
- **Cause**: Insufficient USDC or missing allowances
- **Fix**: Run `approveAllowances.ts` and ensure you have USDC on Polygon

### "Could not create api key"
- **Cause**: Wrong signature type or invalid credentials
- **Fix**: Verify your private key and funder address match

### "No current BTC market found"
- **Cause**: No active 15-min BTC market
- **Fix**: Wait for the next 15-min market to start

## Order Parameters Explained

```typescript
{
  tokenID,           // From market.clobTokenIds[0] (Yes token) or [1] (No token)
  price: 0.20,       // Price between 0.01 and 0.99 (representing probability)
  side: Side.BUY,    // BUY or SELL
  size: 5,           // Number of shares (costs: size × price in USDC)
  feeRateBps: 0,     // Fee rate in basis points (usually 0)
}
```

### Order Cost Example:
- Price: $0.20
- Size: 5 shares
- **Total cost**: 5 × $0.20 = **$1.00 USDC**

## Market Parameters

These must match the market specifications:

```typescript
{
  tickSize: "0.01",  // Minimum price increment (get from market API)
  negRisk: false     // Whether market uses negative risk CTF (get from market API)
}
```

## Order Types

- **GTC** (Good-Till-Cancelled): Order stays until filled or manually cancelled
- **FOK** (Fill-Or-Kill): Must fill immediately and completely, or cancel
- **GTD** (Good-Till-Date): Order expires at specified timestamp

## Resources

- [Polymarket CLOB Documentation](https://docs.polymarket.com/developers/CLOB/introduction)
- [Orders Overview](https://docs.polymarket.com/developers/CLOB/orders/orders)
- [TypeScript Client GitHub](https://github.com/Polymarket/clob-client)
- [Examples Directory](https://github.com/Polymarket/clob-client/tree/main/examples)

## Production Checklist

Before going live with real money:

- [ ] Test with small amounts first
- [ ] Verify order parameters (price, size, side)
- [ ] Implement error handling
- [ ] Monitor gas prices on Polygon
- [ ] Set up proper logging
- [ ] Implement position size limits
- [ ] Test market order cancellation
- [ ] Verify balance checks before each order
- [ ] Set up alerts for failed orders

---
**Last Updated**: 2025-12-24
