import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'

import { AzureBlobUploader } from './AzureBlobUploader.js'

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
if (!connectionString) {
  console.error('AZURE_STORAGE_CONNECTION_STRING environment variable is required')
  process.exit(1)
}

const uploader = new AzureBlobUploader(connectionString)

const containerName = process.env.AZURE_STORAGE_CONTAINER ?? 'markets-parquet'
const concurrency = (() => {
  const raw = process.env.AZURE_UPLOAD_CONCURRENCY
  if (!raw) return 10
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 10
  return n
})()

function utcYYYYMMDDFromEpochSeconds(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

function epochSecondsFromFilename(fileName: string): number | null {
  const m = fileName.match(/(\d+)\.parquet$/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
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
  try {
    const rootAbs = path.join(process.cwd(), 'data', 'events')
    const filePaths = await walkParquetFiles(rootAbs)

    if (filePaths.length === 0) {
      console.error(`[test-upload] no .parquet files found under ${rootAbs}`)
      process.exit(2)
    }

    filePaths.sort((a, b) => a.localeCompare(b))

    console.log(
      `[test-upload] uploading files=${filePaths.length} root=${rootAbs} container=${containerName} concurrency=${concurrency}`,
    )

    let uploaded = 0
    let skipped = 0
    let errored = 0

    for (let i = 0; i < filePaths.length; i += concurrency) {
      const batch = filePaths.slice(i, i + concurrency)
      await Promise.all(
        batch.map(async (filePathAbs) => {
          const rel = path.relative(rootAbs, filePathAbs)
          const relParts = rel.split(path.sep).filter(Boolean)
          const symbol = relParts[0]
          const fileName = path.basename(filePathAbs)
          if (!symbol) {
            skipped += 1
            return
          }

          const epochSeconds = epochSecondsFromFilename(fileName)
          if (epochSeconds === null) {
            console.warn(`[test-upload] skip (no epoch in filename) rel=${rel}`)
            skipped += 1
            return
          }

          const date = utcYYYYMMDDFromEpochSeconds(epochSeconds)
          const blobName = path.posix.join('data/events', symbol, date, fileName)

          try {
            await uploader.uploadFile(containerName, blobName, filePathAbs)
            uploaded += 1
            if (uploaded % 100 === 0) {
              console.log(
                `[test-upload] progress uploaded=${uploaded} skipped=${skipped} errored=${errored} (last=${blobName})`,
              )
            }
          } catch (e) {
            errored += 1
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`[test-upload] upload failed blob=${blobName} file=${filePathAbs}: ${msg}`)
          }
        }),
      )
    }

    console.log(
      `[test-upload] done uploaded=${uploaded} skipped=${skipped} errored=${errored} container=${containerName}`,
    )
  } catch (error) {
    console.error('[test-upload] fatal error:', error)
    process.exit(1)
  }
}

await main()