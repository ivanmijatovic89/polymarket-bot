import 'dotenv/config';
import { BlobServiceClient } from '@azure/storage-blob';

/**
 * Quick test script to verify Azure Blob Storage connection
 *
 * Usage:
 *   tsx src/parquet/test-azure-connection.ts [container-name]
 *
 * Examples:
 *   tsx src/parquet/test-azure-connection.ts
 *   tsx src/parquet/test-azure-connection.ts markets-parquet
 */

async function main() {
  const containerName = process.argv[2] || 'markets-parquet';

  console.log('Testing Azure Blob Storage connection...');
  console.log(`Container: ${containerName}\n`);

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    console.error('❌ AZURE_STORAGE_CONNECTION_STRING environment variable is not set');
    console.error('   Please add it to your .env file\n');
    process.exit(1);
  }

  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Test 1: Check if container exists
    console.log('Test 1: Checking if container exists...');
    const exists = await containerClient.exists();
    if (exists) {
      console.log('✅ Container exists\n');
    } else {
      console.log('⚠️  Container does not exist (will be created on first upload)\n');
    }

    // Test 2: List some blobs
    console.log('Test 2: Listing blobs (max 10)...');
    const blobs: string[] = [];
    const iterator = containerClient.listBlobsFlat().byPage({ maxPageSize: 10 });
    const page = await iterator.next();

    if (!page.done && page.value) {
      for (const blob of page.value.segment.blobItems) {
        blobs.push(blob.name);
      }
    }

    if (blobs.length > 0) {
      console.log(`✅ Found ${blobs.length} blob(s):`);
      blobs.forEach(name => console.log(`   - ${name}`));
      console.log();
    } else {
      console.log('⚠️  No blobs found in container\n');
    }

    // Test 3: Check for parquet files by symbol
    const symbols = ['btc', 'eth', 'sol', 'xrp'];
    console.log('Test 3: Checking for parquet files by symbol...');
    for (const symbol of symbols) {
      const prefix = `${symbol}/`;
      let count = 0;

      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        if (blob.name.endsWith('.parquet')) {
          count++;
          if (count > 100) break; // Stop counting after 100
        }
      }

      if (count > 0) {
        console.log(`✅ ${symbol.toUpperCase()}: ${count}${count > 100 ? '+' : ''} parquet file(s)`);
      }
    }

    console.log('\n✅ All tests passed! Azure Blob Storage connection is working.');
    console.log('\nYou can now:');
    console.log('  1. Upload files: tsx src/parquet/test-upload.ts');
    console.log(`  2. List files:   npm run list:backtest-files -- --symbol btc --azure-blob --azure-container ${containerName}`);
    console.log(`  3. Run backtest: npm run backtest -- --strategy <id> --azure-blob --azure-container ${containerName} <blob-names>`);

  } catch (error) {
    console.error('\n❌ Connection test failed:');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
      if (error.message.includes('getaddrinfo')) {
        console.error('\n   Possible causes:');
        console.error('   - Network connectivity issues');
        console.error('   - Incorrect storage account name in connection string');
      } else if (error.message.includes('auth')) {
        console.error('\n   Possible causes:');
        console.error('   - Invalid account key in connection string');
        console.error('   - Connection string format is incorrect');
      }
    } else {
      console.error(`   ${String(error)}`);
    }
    process.exit(1);
  }
}

main();
