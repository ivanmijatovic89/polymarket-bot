# Test Trading Scripts - Quick Reference

## 📁 Files in This Directory

| File | Purpose | Run Frequency |
|------|---------|---------------|
| [testOrder.ts](testOrder.ts) | Place test orders on Polymarket | As needed |
| [approveAllowances.ts](approveAllowances.ts) | Approve USDC/CTF contracts | **One-time only** ✅ |
| [checkBalance.ts](checkBalance.ts) | Check USDC/MATIC balances | As needed |
| [checkAddress.ts](checkAddress.ts) | Verify address matching | Debug only |
| [README.md](README.md) | **📖 Full technical documentation** | - |
| [SETUP_TRADING.md](SETUP_TRADING.md) | End-user setup guide | - |

## 🚀 Quick Start

### First Time Setup
```bash
# 1. Already done ✅ - Allowances approved on Polygon mainnet
npx tsx src/test-trading/approveAllowances.ts
```

### Check Before Trading
```bash
# Check your balances
npx tsx src/test-trading/checkBalance.ts
```

### Place Order
```bash
# Place a test order (needs USDC)
npx tsx src/test-trading/testOrder.ts
```

## ⚠️ Current Status

| Item | Status |
|------|--------|
| Scripts working | ✅ All functional |
| Allowances approved | ✅ On Polygon mainnet |
| MATIC balance | ✅ 4.98 MATIC |
| USDC balance | ❌ 0.0 USDC |
| **Can place orders** | ❌ Need USDC first |

## 📚 Documentation

- **Quick Reference**: This file
- **Technical Details**: [README.md](README.md) - Full context, learnings, integration path
- **Setup Guide**: [SETUP_TRADING.md](SETUP_TRADING.md) - Environment setup, parameters, troubleshooting
- **Project Summary**: [../../TEST_TRADING_SUMMARY.md](../../TEST_TRADING_SUMMARY.md) - What was done, issues fixed

## 🔗 External Resources

- [Polymarket CLOB Docs](https://docs.polymarket.com/developers/CLOB/introduction)
- [TypeScript Client](https://github.com/Polymarket/clob-client)
- [Example Scripts](https://github.com/Polymarket/clob-client/tree/main/examples)

## 💡 Need Help?

1. **Getting errors?** → See [SETUP_TRADING.md](SETUP_TRADING.md) Troubleshooting section
2. **Want to understand the code?** → See [README.md](README.md) Technical Details
3. **Integrating into main bot?** → See [README.md](README.md) Integration Path

---
**Last Updated**: 2025-12-24
