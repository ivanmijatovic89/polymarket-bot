import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { BlobServiceClient } from '@azure/storage-blob'

type Args = {
  symbol: string
  root: string
  limit?: number
  azureBlob?: boolean
  azureContainer?: string
}

function parseArgs(argv: string[]): Args | null {
  let symbol: string | undefined
  let root = 'data/events'
  let limit: number | undefined
  let azureBlob = false
  let azureContainer: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a) continue

    if (a === '--symbol' || a === '-s') {
      symbol = argv[i + 1]
      i += 1
      continue
    }

    if (a === '--root') {
      root = argv[i + 1] ?? root
      i += 1
      continue
    }

    if (a === '--limit' || a === '-l') {
      const raw = argv[i + 1]
      const n = raw ? Number(raw) : NaN
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
      limit = n
      i += 1
      continue
    }

    if (a === '--azure-blob') {
      azureBlob = true
      continue
    }

    if (a === '--azure-container') {
      azureContainer = argv[i + 1]
      i += 1
      continue
    }

    if (a === '--help' || a === '-h') return null

    // Positional: first positional is symbol.
    if (!a.startsWith('-') && !symbol) {
      symbol = a
      continue
    }
  }

  if (!symbol) return null
  return {
    symbol,
    root,
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(azureBlob ? { azureBlob } : {}),
    ...(azureContainer ? { azureContainer } : {})
  }
}

function epochFromFilename(fileName: string): number | null {
  // Example: btc-updown-15m-1766523600.parquet
  const m = fileName.match(/(\d+)\.parquet$/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return n
}

async function walkParquetFiles(dirAbs: string): Promise<string[]> {
  const out: string[] = []
  const dirents = await fs.readdir(dirAbs, { withFileTypes: true })
  for (const d of dirents) {
    const full = path.join(dirAbs, d.name)
    if (d.isDirectory()) {
      out.push(...(await walkParquetFiles(full)))
      continue
    }
    if (d.isFile() && d.name.endsWith('.parquet')) out.push(full)
  }
  return out
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    console.error(
      'Usage:\n' +
        '  Local files:\n' +
        '    tsx src/parquet/cli/list-backtest-files.ts --symbol <btc|eth|sol|...> [--root data/events] [--limit N]\n' +
        '  Azure Blob Storage:\n' +
        '    tsx src/parquet/cli/list-backtest-files.ts --symbol <btc|eth|sol|...> --azure-blob --azure-container <container> [--limit N]\n' +
        '    Requires AZURE_STORAGE_CONNECTION_STRING environment variable\n' +
        'Examples:\n' +
        '  tsx src/parquet/cli/list-backtest-files.ts --symbol btc\n' +
        '  tsx src/parquet/cli/list-backtest-files.ts --symbol btc --limit 10\n' +
        '  tsx src/parquet/cli/list-backtest-files.ts --symbol btc --azure-blob --azure-container markets-parquet\n' +
        '  npm run -s list:backtest-files -- --symbol btc',
    )
    process.exit(2)
  }

  const symbol = parsed.symbol.toLowerCase()
  const limit = parsed.limit

  let files: string[]

  if (parsed.azureBlob) {
    // List files from Azure Blob Storage
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!connectionString) {
      console.error('[list-backtest-files] AZURE_STORAGE_CONNECTION_STRING environment variable is required when using --azure-blob')
      process.exit(2)
    }
    if (!parsed.azureContainer) {
      console.error('[list-backtest-files] --azure-container is required when using --azure-blob')
      process.exit(2)
    }

    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
      const containerClient = blobServiceClient.getContainerClient(parsed.azureContainer)

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
        console.error(`[list-backtest-files] no files found with prefix "${prefix}", trying "${symbol}/"...`)
        prefix = `${symbol}/`
        for await (const blob of containerClient.listBlobsFlat({ prefix })) {
          if (blob.name.endsWith('.parquet')) {
            blobNames.push(blob.name)
          }
        }
      }

      // If still no files found, search without prefix (flat structure)
      if (blobNames.length === 0) {
        console.error(`[list-backtest-files] no files found with prefix "${prefix}", searching without prefix...`)

        // List all blobs and filter by symbol in filename
        for await (const blob of containerClient.listBlobsFlat()) {
          if (blob.name.endsWith('.parquet') && blob.name.toLowerCase().includes(symbol)) {
            blobNames.push(blob.name)
          }
        }
      }

      if (blobNames.length === 0) {
        console.error(`[list-backtest-files] no .parquet files found for symbol "${symbol}" in container "${parsed.azureContainer}"`)
        process.exit(2)
      }

      files = blobNames
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[list-backtest-files] failed to list blobs: ${msg}`)
      process.exit(2)
    }
  } else {
    // List files from local filesystem
    const rootRel = parsed.root
    const dirAbs = path.resolve(process.cwd(), rootRel, symbol)

    let filesAbs: string[]
    try {
      filesAbs = await walkParquetFiles(dirAbs)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[list-backtest-files] failed to read "${dirAbs}": ${msg}`)
      process.exit(2)
    }

    const filesRel = filesAbs
      .map((abs) => path.relative(dirAbs, abs))
      .filter((rel) => rel.length > 0)

    if (filesRel.length === 0) {
      console.error(`[list-backtest-files] no .parquet files found in "${dirAbs}"`)
      process.exit(2)
    }

    // Add path prefix for local files
    const rootPosix = rootRel.split(path.sep).join(path.posix.sep)
    files = filesRel
      .map((f) => f.split(path.sep).join(path.posix.sep))
      .map((f) => path.posix.join(rootPosix, symbol, f))
  }

  // Sort files by epoch timestamp
  files.sort((a, b) => {
    const ea = epochFromFilename(path.basename(a))
    const eb = epochFromFilename(path.basename(b))
    if (ea !== null && eb !== null && ea !== eb) return ea - eb
    return a.localeCompare(b)
  })

  const limitedFiles = typeof limit === 'number' ? files.slice(0, limit) : files

  // Print space-separated file list
  const out = limitedFiles.join(' ')
  process.stdout.write(`${out}\n`)
}

await main()
