import 'dotenv/config';
import { AzureBlobUploader } from './AzureBlobUploader.js';
import { readdir } from 'fs/promises';
import { join } from 'path';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connectionString) {
  console.error('AZURE_STORAGE_CONNECTION_STRING environment variable is required');
  process.exit(1);
}

const uploader = new AzureBlobUploader(connectionString);

const dataDir = join(process.cwd(), 'data', 'events', 'btc');

async function main() {
  try {
    const files = await readdir(dataDir);
    const filesToUpload = files.slice(0, 50); // Upload first 50 files

    const containerName = 'markets-parquet';

    // Upload in batches of 10
    for (let i = 0; i < filesToUpload.length; i += 10) {
      const batch = filesToUpload.slice(i, i + 10);
      console.log(`Uploading batch ${Math.floor(i / 10) + 1}...`);
      await Promise.all(batch.map(async (file) => {
        const filePath = join(dataDir, file);
        const blobName = `btc/${file}`; // Add symbol prefix for organization
        console.log(`Uploading ${blobName}...`);
        await uploader.uploadFile(containerName, blobName, filePath);
        console.log(`Uploaded ${blobName}`);
      }));
    }

    console.log('All files uploaded successfully');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();