import { promises as fs } from 'fs'
import path from 'path'

export async function resolveParquetFilesFromDirs(dirs: string[]): Promise<string[]> {
  const out: string[] = []
  for (const rawDir of dirs) {
    const dir = path.resolve(rawDir)
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.parquet')) continue
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

