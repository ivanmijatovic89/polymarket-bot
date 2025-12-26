import { BlobServiceClient } from '@azure/storage-blob'
import * as parquet from '@dsnp/parquetjs'

/**
 * Streams a parquet file from Azure Blob Storage directly into memory
 * and opens it as a ParquetReader without writing to disk.
 */
export async function openParquetFromAzureBlob(
  connectionString: string,
  containerName: string,
  blobName: string
): Promise<parquet.ParquetReader> {
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(containerName)
  const blobClient = containerClient.getBlobClient(blobName)

  // Download blob to buffer
  const downloadResponse = await blobClient.download()

  if (!downloadResponse.readableStreamBody) {
    throw new Error(`Failed to get readable stream for blob: ${blobName}`)
  }

  // Convert stream to buffer
  const chunks: Buffer[] = []
  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(Buffer.from(chunk))
  }
  const buffer = Buffer.concat(chunks)

  // Open parquet reader from buffer
  return await parquet.ParquetReader.openBuffer(buffer)
}

/**
 * Opens multiple parquet files from Azure Blob Storage concurrently
 */
export async function openMultipleParquetFromAzureBlob(
  connectionString: string,
  containerName: string,
  blobNames: string[]
): Promise<parquet.ParquetReader[]> {
  return await Promise.all(
    blobNames.map(blobName =>
      openParquetFromAzureBlob(connectionString, containerName, blobName)
    )
  )
}

/**
 * Opens parquet files in batches, yielding readers as they become available.
 * This allows processing to start before all files are downloaded.
 *
 * @param batchSize Number of files to download concurrently (default: 5)
 */
export async function* openParquetFromAzureBlobBatched(
  connectionString: string,
  containerName: string,
  blobNames: string[],
  batchSize: number = 5
): AsyncGenerator<{ reader: parquet.ParquetReader; blobName: string; index: number }> {
  for (let i = 0; i < blobNames.length; i += batchSize) {
    const batch = blobNames.slice(i, i + batchSize)
    const readers = await Promise.all(
      batch.map(async (blobName, batchIndex) => ({
        reader: await openParquetFromAzureBlob(connectionString, containerName, blobName),
        blobName,
        index: i + batchIndex
      }))
    )

    for (const result of readers) {
      yield result
    }
  }
}
