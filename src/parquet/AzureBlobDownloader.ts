import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';

export type DownloadedBlob = {
  tempFilePath: string;
  originalBlobName: string;
}

export class AzureBlobDownloader {
  private blobServiceClient: BlobServiceClient;

  constructor(connectionString: string) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  }

  async downloadToTempFile(containerName: string, blobName: string): Promise<DownloadedBlob> {
    const containerClient: ContainerClient = this.blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const downloadResponse = await blockBlobClient.download();
    const data = await this.streamToBuffer(downloadResponse.readableStreamBody!);

    // Use original filename in temp file to preserve slug parsing
    const originalFilename = basename(blobName);
    const tempFilePath = join(tmpdir(), `azure_${randomBytes(4).toString('hex')}_${originalFilename}`);
    await writeFile(tempFilePath, data);

    return { tempFilePath, originalBlobName: blobName };
  }

  async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      console.warn(`Failed to cleanup temp file ${filePath}:`, error);
    }
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}