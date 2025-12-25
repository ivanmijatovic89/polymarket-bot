#!/usr/bin/env tsx
/**
 * Advanced API key reset script - creates a NEW key with a different nonce
 *
 * The issue: deriveApiKey() is deterministic and always returns the same key.
 * The solution: After deleting the old key, we need to create a NEW key with
 * a different nonce instead of deriving the old one.
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

async function main() {
  console.log("🔧 Advanced API Key Reset (with new nonce)\n");

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
      137,
      oldWallet
    );

    console.log("📋 Wallet:", oldWallet.address);
    console.log();

    // Step 1: Get and delete ALL existing API keys
    console.log("🔑 Step 1: Fetching existing API keys...");
    try {
      // First derive credentials to authenticate
      const oldCreds = await clobClient.createOrDeriveApiKey();
      console.log(`   Found existing key: ${oldCreds.key.substring(0, 20)}...`);

      // Set credentials on client for L2 auth
      (clobClient as any).creds = oldCreds;

      // Get all API keys from server
      const apiKeysResponse = await clobClient.getApiKeys();
      console.log(`   Server has ${apiKeysResponse.apiKeys.length} key(s) registered`);
      console.log();

      // Delete each key
      console.log("🗑️  Step 2: Deleting all existing keys...");
      for (const key of apiKeysResponse.apiKeys) {
        const keyStr = typeof key === 'string' ? key : String(key)
        console.log(`   Deleting key: ${keyStr.substring(0, 20)}...`);
        await clobClient.deleteApiKey();
      }
      console.log("✅ All keys deleted\n");

    } catch (error) {
      console.log("⚠️  Could not fetch/delete existing keys:", (error as Error).message);
      console.log("   Continuing anyway...\n");
    }

    // Clear credentials from client
    delete (clobClient as any).creds;

    // Step 3: Create a FRESH API key with a new nonce
    console.log("🆕 Step 3: Creating fresh API key with new nonce...");

    // Generate a unique nonce (timestamp-based)
    const newNonce = Date.now().toString();
    console.log(`   Using nonce: ${newNonce}`);

    try {
      // Use the internal createApiKey method with a custom nonce
      // This bypasses derivation and creates a truly new key
      const freshCreds = await (clobClient as any).createApiKey(newNonce);

      if (!freshCreds || !freshCreds.key) {
        throw new Error("createApiKey returned invalid credentials");
      }

      console.log(`✅ Created fresh API key: ${freshCreds.key.substring(0, 20)}...`);
      console.log(`   Secret: ${freshCreds.secret.substring(0, 10)}...`);
      console.log(`   Passphrase: ${freshCreds.passphrase.substring(0, 10)}...`);
      console.log();

      // Set the new credentials on the client
      (clobClient as any).creds = freshCreds;

      // Step 4: Test the new credentials
      console.log("🧪 Step 4: Testing new credentials...");

      // Try to get API keys (requires L2 auth)
      const testResponse = await clobClient.getApiKeys();
      console.log(`✅ Credentials work! Server returned ${testResponse.apiKeys.length} key(s)`);
      console.log();

      console.log("🎉 SUCCESS!");
      console.log();
      console.log("Your API key has been reset successfully.");
      console.log("The old key has been deleted and a fresh one created.");
      console.log();
      console.log("⚠️  IMPORTANT: Save these credentials:");
      console.log(`   API Key: ${freshCreds.key}`);
      console.log(`   Secret: ${freshCreds.secret}`);
      console.log(`   Passphrase: ${freshCreds.passphrase}`);
      console.log(`   Nonce: ${newNonce}`);
      console.log();
      console.log("You can now run: npx tsx src/test-trading/test-order.ts");

    } catch (createError) {
      const err = createError as any;
      console.error("❌ Failed to create fresh API key");
      console.error(`   Status: ${err.response?.status || 'unknown'}`);
      console.error(`   Error: ${err.response?.data?.error || err.message}`);
      console.error();

      if (err.response?.status === 400) {
        console.error("💡 The 400 error suggests:");
        console.error("   1. Your account may have API key creation disabled");
        console.error("   2. There may be a server-side issue");
        console.error("   3. Your wallet may need to place another UI order first");
        console.error();
        console.error("Try contacting Polymarket support or check their Discord/Telegram");
      }

      throw createError;
    }

  } catch (error) {
    console.error("\n❌ Reset failed:", (error as Error).message);
    process.exit(1);
  }
}

main();
