import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { readFileSync } from 'fs';

export class AzureBlobUploader {
  private blobServiceClient: BlobServiceClient;

  constructor(connectionString: string) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  }

  async uploadFile(containerName: string, blobName: string, filePath: string): Promise<void> {
    const containerClient: ContainerClient = this.blobServiceClient.getContainerClient(containerName);

    // Ensure the container exists
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const data = readFileSync(filePath);

    await blockBlobClient.upload(data, data.length);
  }
}