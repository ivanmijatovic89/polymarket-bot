import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Each instance owns its spill files, including when readers and writers run
 * in separate processes with the same working directory. */
export async function createResearchDatabase() {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'polymarket-research-duckdb-'))
  let instance: DuckDBInstance | undefined
  let connection: DuckDBConnection | undefined
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    try {
      connection?.closeSync()
    } finally {
      try {
        instance?.closeSync()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    }
  }
  try {
    instance = await DuckDBInstance.create(':memory:', {
      threads: '2',
      memory_limit: '512MB',
      temp_directory: tempDirectory,
    })
    connection = await instance.connect()
    return { connection, close, tempDirectory }
  } catch (error) {
    close()
    throw error
  }
}
