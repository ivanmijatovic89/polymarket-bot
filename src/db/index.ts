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
  options: {
    /**
     * Server-side blocking wait for GET_LOCK (seconds). Default 0 =
     * non-blocking try. A restarted daemon uses this to wait out its own
     * dead predecessor's lease instead of failing instantly.
     */
    waitSeconds?: number
    /**
     * Session idle timeout applied to the LEASE connection after acquiring.
     * A silently-dead holder (laptop sleep, network loss) is reaped by the
     * server — and its lock freed — within this bound. The 60s keepalive
     * ping keeps a live holder well inside it. Default 300 (≤5 min stale
     * lease, documented).
     */
    sessionTimeoutSeconds?: number
  } = {},
): Promise<(() => Promise<void>) | null> {
  const waitSeconds = Math.max(0, Math.floor(options.waitSeconds ?? 0))
  const sessionTimeoutSeconds = Math.max(120, Math.floor(options.sessionTimeoutSeconds ?? 300))
  const connection = await getPool().getConnection()
  try {
    const [rows] = await connection.query<Array<RowDataPacket & { acquired: number | null }>>(
      "SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':', ?), 256), ?) AS acquired",
      [name, waitSeconds],
    )
    if (rows[0]?.acquired !== 1) {
      connection.destroy()
      return null
    }
    // Bounded stale-lease guarantee: the server reaps this connection (and
    // frees the lock) if it goes silent longer than the session timeout.
    await connection.query('SET SESSION wait_timeout = ?, interactive_timeout = ?', [
      sessionTimeoutSeconds,
      sessionTimeoutSeconds,
    ])

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
        // destroy, not release: this connection carries a shortened session
        // timeout and must never return to the shared pool where it could
        // die idle under a later borrower.
        connection.destroy()
      }
    }
  } catch (error) {
    connection.destroy()
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
