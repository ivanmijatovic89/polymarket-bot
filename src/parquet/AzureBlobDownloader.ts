import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';
import * as parquet from '@dsnp/parquetjs';

export class AzureBlobDownloader {
  private blobServiceClient: BlobServiceClient;

  constructor(connectionString: string) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  }

  /**
   * Create a ParquetReader that streams directly from Azure Blob Storage
   * using range requests - reads only needed parts of files on-demand.
   *
   * This follows the same pattern as ParquetReader.openS3() - using
   * ParquetEnvelopeReader with a custom readFn that makes HTTP range requests.
   */
  async openParquetReader(
    containerName: string,
    blobName: string,
  ): Promise<parquet.ParquetReader> {
    const containerClient: ContainerClient =
      this.blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Get file size (needed for ParquetEnvelopeReader)
    // Use async function like openS3 does, in case we need to refresh properties
    const fileStat = async () => {
      const properties = await blockBlobClient.getProperties();
      const size = properties.contentLength ?? 0;
      if (size === 0) {
        throw new Error(`Blob ${blobName} has zero size`);
      }
      return size;
    };

    // Create readFn that uses Azure SDK range requests (true streaming)
    // This function is called by ParquetEnvelopeReader whenever it needs
    // to read a specific byte range from the file.
    // Signature matches openS3: (offset, length, file) => Promise<Buffer>
    const readFn = async (offset: number, length: number, file?: string): Promise<Buffer> => {
      if (file) {
        return Promise.reject('external references are not supported');
      }

      // Azure SDK download(offset, count) - offset is inclusive, count is bytes to read
      const downloadResponse = await blockBlobClient.download(offset, length);

      if (!downloadResponse.readableStreamBody) {
        throw new Error(
          `Failed to download range for blob: ${blobName} (offset=${offset}, length=${length})`,
        );
      }

      // Convert only this small range stream to buffer (not the whole file!)
      return await this.streamToBuffer(downloadResponse.readableStreamBody);
    };

    const closeFn = () => ({}); // No cleanup needed for Azure Blob

    // Access internal ParquetEnvelopeReader class (similar to how openS3 does it)
    const ParquetEnvelopeReader = (parquet as any).ParquetEnvelopeReader;
    const envelopeReader = new ParquetEnvelopeReader(readFn, closeFn, fileStat);

    // Open the reader using internal method (same as openS3/openUrl)
    return await (parquet.ParquetReader as any).openEnvelopeReader(envelopeReader);
  }

  async downloadToTempFile(containerName: string, blobName: string): Promise<string> {
    const containerClient: ContainerClient = this.blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const downloadResponse = await blockBlobClient.download();
    const data = await this.streamToBuffer(downloadResponse.readableStreamBody!);

    const tempFilePath = join(tmpdir(), `parquet_${randomBytes(8).toString('hex')}.parquet`);
    await writeFile(tempFilePath, data);

    return tempFilePath;
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

/**
 * Check if a path looks like an Azure blob path.
 * Azure blob paths are typically: "container-name/blob-name.parquet"
 * or "azure://container-name/blob-name.parquet"
 */
export function isAzureBlobPath(path: string): boolean {
  // Azure blob paths typically:
  // - Contain '/' but don't start with '/' (not absolute local path)
  // - Don't match Windows drive pattern (C:\...)
  // - Could have explicit "azure://" prefix
  if (path.startsWith('azure://')) return true;
  if (path.includes('/') && !path.startsWith('/') && !path.match(/^[A-Z]:\\/)) {
    return true;
  }
  return false;
}

/**
 * Parse an Azure blob path into container and blob name.
 * Supports formats:
 * - "container-name/blob-name.parquet"
 * - "azure://container-name/blob-name.parquet"
 *
 * Returns null if path cannot be parsed.
 */
export function parseAzureBlobPath(path: string): { container: string; blobName: string } | null {
  // Remove explicit azure:// prefix if present
  const cleanPath = path.startsWith('azure://') ? path.slice(8) : path;

  const parts = cleanPath.split('/');
  if (parts.length < 2) return null;

  const container = parts[0]!;
  const blobName = parts.slice(1).join('/');
  return { container, blobName };
}