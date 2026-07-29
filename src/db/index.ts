import { drizzle } from 'drizzle-orm/mysql2'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { loadDatabaseConfigFromEnv } from './config.js'
import * as schema from './schema.js'

let dbInstance: ReturnType<typeof drizzle> | undefined
let poolInstance: ReturnType<typeof mysql.createPool> | null = null

function getPool(): ReturnType<typeof mysql.createPool> {
  if (poolInstance) return poolInstance
  const config = loadDatabaseConfigFromEnv()
  const poolConfig: mysql.PoolOptions = {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
  }
  if (config.password !== undefined) {
    poolConfig.password = config.password
  }
  poolInstance = mysql.createPool(poolConfig)
  return poolInstance
}

export function getDb(): ReturnType<typeof drizzle> {
  if (dbInstance) return dbInstance
  dbInstance = drizzle({ client: getPool(), schema, mode: 'default' }) as unknown as ReturnType<
    typeof drizzle
  >
  return dbInstance
}

export async function acquireDbAdvisoryLock(
  name: string,
  onLost: (error: unknown) => void,
): Promise<(() => Promise<void>) | null> {
  const connection = await getPool().getConnection()
  try {
    const [rows] = await connection.query<Array<RowDataPacket & { acquired: number | null }>>(
      "SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':', ?), 256), 0) AS acquired",
      [name],
    )
    if (rows[0]?.acquired !== 1) {
      connection.release()
      return null
    }

    let released = false
    const handleLost = (error: unknown) => {
      if (released) return
      released = true
      clearInterval(keepAlive)
      connection.off('error', handleLost)
      connection.off('end', handleEnd)
      connection.destroy()
      try {
        onLost(error)
      } catch {
        // The connection is already gone; lease-loss reporting is best-effort.
      }
    }
    const handleEnd = () => handleLost(new Error('Global Runtime lease connection ended'))
    connection.once('error', handleLost)
    connection.once('end', handleEnd)
    const keepAlive = setInterval(() => {
      void connection.ping().catch(handleLost)
    }, 60_000)
    keepAlive.unref()
    return async () => {
      if (released) return
      released = true
      clearInterval(keepAlive)
      connection.off('error', handleLost)
      connection.off('end', handleEnd)
      try {
        await connection.query("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':', ?), 256))", [name])
      } finally {
        connection.release()
      }
    }
  } catch (error) {
    connection.release()
    throw error
  }
}

export async function closeDb() {
  if (poolInstance) {
    await poolInstance.end()
    poolInstance = null
    dbInstance = undefined
  }
}

export * from './schema.js'
