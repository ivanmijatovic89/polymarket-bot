import * as parquet from '@dsnp/parquetjs'
import {
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob'

export type BacktestSource = 'local' | 'azure'

export type AzureParquetSourceConfig = {
  connectionString: string
  containerName: string
  /**
   * SAS validity (ms). Must cover the backtest duration for each file.
   * Defaults to 12h.
   */
  sasTtlMs?: number
}

function parseAzureConnectionString(cs: string): {
  accountName: string
  accountKey: string
  blobEndpoint: string
} {
  const parts = cs
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  const kv: Record<string, string> = {}
  for (const p of parts) {
    const idx = p.indexOf('=')
    if (idx <= 0) continue
    const k = p.slice(0, idx)
    const v = p.slice(idx + 1)
    kv[k] = v
  }

  const accountName = kv['AccountName']
  const accountKey = kv['AccountKey']
  if (!accountName || !accountKey) {
    throw new Error('[azureParquetSource] invalid connection string (missing AccountName/AccountKey)')
  }

  // Prefer an explicit BlobEndpoint if present; otherwise build the standard endpoint.
  const endpointSuffix = kv['EndpointSuffix'] || 'core.windows.net'
  const blobEndpointRaw = kv['BlobEndpoint'] || `https://${accountName}.blob.${endpointSuffix}`
  const blobEndpoint = blobEndpointRaw.replace(/\/+$/, '')

  return { accountName, accountKey, blobEndpoint }
}

function encodeBlobName(blobName: string): string {
  // Keep slashes, encode each segment.
  return blobName
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join('/')
}

export function normalizeBlobName(input: string): string {
  // Accept either a blob-name-like path or a local-path-like string.
  return input.replaceAll('\\', '/').replace(/^\/+/, '')
}

export function makeBlobReadSasUrl(args: {
  azure: AzureParquetSourceConfig
  blobName: string
}): string {
  const { accountName, accountKey, blobEndpoint } = parseAzureConnectionString(args.azure.connectionString)
  const cred = new StorageSharedKeyCredential(accountName, accountKey)

  const now = Date.now()
  const startsOn = new Date(now - 5 * 60_000) // skew tolerance
  const expiresOn = new Date(now + (args.azure.sasTtlMs ?? 12 * 60 * 60_000))

  const sas = generateBlobSASQueryParameters(
    {
      containerName: args.azure.containerName,
      blobName: args.blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
    },
    cred,
  ).toString()

  const url = `${blobEndpoint}/${encodeURIComponent(args.azure.containerName)}/${encodeBlobName(args.blobName)}`
  return `${url}?${sas}`
}

export async function openParquetReaderFromSource(args: {
  source: BacktestSource
  filePathOrBlobName: string
  azure?: AzureParquetSourceConfig
}): Promise<parquet.ParquetReader> {
  if (args.source === 'local') {
    return parquet.ParquetReader.openFile(args.filePathOrBlobName)
  }

  if (!args.azure) {
    throw new Error('[azureParquetSource] source=azure requires azure config')
  }

  const blobName = normalizeBlobName(args.filePathOrBlobName)
  const sasUrl = makeBlobReadSasUrl({ azure: args.azure, blobName })
  // ParquetReader.openUrl uses HTTP range reads (via fetch) and does not download the whole file.
  return parquet.ParquetReader.openUrl(sasUrl)
}


