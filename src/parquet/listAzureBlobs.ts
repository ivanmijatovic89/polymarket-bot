import { BlobServiceClient } from '@azure/storage-blob'
import path from 'node:path'

function epochFromFilename(fileName: string): number | null {
  // Example: btc-updown-15m-1766523600.parquet
  const m = fileName.match(/(\d+)\.parquet$/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return n
}

export async function listAzureBlobs(params: {
  connectionString: string
  containerName: string
  symbol: string
  limit?: number
}): Promise<string[]> {
  const { connectionString, containerName, symbol, limit } = params

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(containerName)

  const blobNames: string[] = []

  // Try with new structure first: data/events/btc/
  let prefix = `data/events/${symbol}/`
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    if (blob.name.endsWith('.parquet')) {
      blobNames.push(blob.name)
    }
  }

  // If no files found with new structure, try old structure: btc/
  if (blobNames.length === 0) {
    console.error(`[listAzureBlobs] no files found with prefix "${prefix}", trying "${symbol}/"...`)
    prefix = `${symbol}/`
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      if (blob.name.endsWith('.parquet')) {
        blobNames.push(blob.name)
      }
    }
  }

  // If still no files found, search without prefix (flat structure)
  if (blobNames.length === 0) {
    console.error(`[listAzureBlobs] no files found with prefix "${prefix}", searching without prefix...`)

    // List all blobs and filter by symbol in filename
    for await (const blob of containerClient.listBlobsFlat()) {
      if (blob.name.endsWith('.parquet') && blob.name.toLowerCase().includes(symbol)) {
        blobNames.push(blob.name)
      }
    }
  }

  if (blobNames.length === 0) {
    throw new Error(`no .parquet files found for symbol "${symbol}" in container "${containerName}"`)
  }

  // Sort files by epoch timestamp
  blobNames.sort((a, b) => {
    const ea = epochFromFilename(path.basename(a))
    const eb = epochFromFilename(path.basename(b))
    if (ea !== null && eb !== null && ea !== eb) return ea - eb
    return a.localeCompare(b)
  })

  return typeof limit === 'number' ? blobNames.slice(0, limit) : blobNames
}
