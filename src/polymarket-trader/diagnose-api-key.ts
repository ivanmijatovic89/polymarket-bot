#!/usr/bin/env tsx
/**
 * Diagnostic script to understand API key issues
 *
 * This will check various aspects of your Polymarket setup
 */

import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClobClient } from "@polymarket/clob-client";
import { Wallet as OldWallet } from "@ethersproject/wallet";

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env");
config({ path: envPath });

async function diagnose() {
  console.log("🔍 Diagnosing Polymarket API Key Issues\n");

  const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
  const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS;

  if (!privateKey || !funderAddress) {
    console.error("❌ Missing environment variables");
    process.exit(1);
  }

  try {
    // Create CLOB client
    const oldWallet = new OldWallet(privateKey);
    const clobClient = new ClobClient(
      'https://clob.polymarket.com',
      137, // Polygon mainnet
      oldWallet
    );

    console.log("📋 Wallet Information:");
    console.log(`   Address: ${oldWallet.address}`);
    console.log(`   Funder:  ${funderAddress}`);
    console.log(`   Match:   ${oldWallet.address === funderAddress ? '✅ YES' : '❌ NO'}\n`);

    // Try to get existing API keys
    console.log("🔑 Checking existing API keys...");
    try {
      // First, derive credentials to set them on the client
      const derivedCreds = await clobClient.createOrDeriveApiKey();
      console.log(`   Derived API Key: ${derivedCreds.key.substring(0, 15)}...`);

      // Now try to get all API keys (requires L2 auth)
      (clobClient as any).creds = derivedCreds;
      const apiKeys = await clobClient.getApiKeys();
      console.log(`   Server API Keys:`, apiKeys);
      console.log();
    } catch (error) {
      console.log(`   ⚠️  Could not fetch API keys: ${(error as Error).message}\n`);
    }

    // Check if account is restricted
    console.log("🚫 Checking account restrictions...");
    try {
      // Re-derive credentials for this check
      const derivedCreds = await clobClient.createOrDeriveApiKey();
      (clobClient as any).creds = derivedCreds;

      const closedOnlyStatus = await clobClient.getClosedOnlyMode();
      console.log(`   Closed-only mode:`, closedOnlyStatus);
      console.log();
    } catch (error) {
      console.log(`   ⚠️  Could not check restrictions: ${(error as Error).message}\n`);
    }

    // Try creating a NEW API key (POST, not GET/derive)
    console.log("🆕 Attempting to create NEW API key...");
    let derivedCreds: any;
    try {
      derivedCreds = await clobClient.createOrDeriveApiKey();
    } catch (e) {
      // Ignore, we just need this for comparison
    }

    try {
      const newCreds = await (clobClient as any).createApiKey();
      console.log(`   ✅ Created new API key: ${newCreds.key.substring(0, 15)}...`);
      if (derivedCreds) {
        console.log(`   This key is different from derived key: ${newCreds.key !== derivedCreds.key ? 'YES' : 'NO'}\n`);
      }
    } catch (error) {
      const err = error as any;
      console.log(`   ❌ Failed to create new API key`);
      console.log(`   Status: ${err.response?.status || 'unknown'}`);
      console.log(`   Error: ${err.response?.data?.error || err.message}`);
      console.log();

      if (err.response?.status === 400 && err.response?.data?.error === "Could not create api key") {
        console.log("💡 DIAGNOSIS:");
        console.log("   Your wallet has NOT been initialized on Polymarket.");
        console.log();
        console.log("   To fix this, you need to:");
        console.log("   1. Go to https://polymarket.com");
        console.log("   2. Connect your wallet (0x" + oldWallet.address.substring(2, 8) + "...)");
        console.log("   3. Place at least ONE order through the UI (even $0.01)");
        console.log("   4. After your first order, API key creation will work");
        console.log();
        console.log("   This is a one-time requirement to initialize your account.");
        console.log();
      }
    }

  } catch (error) {
    console.error("\n❌ Error during diagnosis:", (error as Error).message);
    throw error;
  }
}

diagnose().catch(error => {
  console.error("\nDiagnosis failed:", error);
  process.exit(1);
});
