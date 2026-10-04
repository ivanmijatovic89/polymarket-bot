import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { TABLES } from './storage.js'

export interface FileDigest {
  bytes: number
  sha256: string
}

export async function fileDigest(file: string): Promise<FileDigest> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return { bytes: (await stat(file)).size, sha256: hash.digest('hex') }
}

export async function snapshotDigests(directory: string): Promise<Record<string, FileDigest>> {
  const result: Record<string, FileDigest> = {}
  for (const file of [...TABLES.map((table) => `${table}.parquet`), 'wallet-queries.json']) {
    result[file] = await fileDigest(path.join(directory, file))
  }
  return result
}

export async function checkDigests(
  directory: string,
  expected: Record<string, FileDigest>,
): Promise<string[]> {
  const errors: string[] = []
  for (const file of [...TABLES.map((table) => `${table}.parquet`), 'wallet-queries.json']) {
    const digest = expected[file]
    if (!digest) {
      errors.push(`Missing checksum: ${file}`)
      continue
    }
    try {
      const actual = await fileDigest(path.join(directory, file))
      if (actual.bytes !== digest.bytes || actual.sha256 !== digest.sha256)
        errors.push(`Checksum mismatch: ${file}`)
    } catch (error) {
      errors.push(`Cannot read ${file}: ${String(error)}`)
    }
  }
  return errors
}
