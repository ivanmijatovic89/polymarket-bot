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
