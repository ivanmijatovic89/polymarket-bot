import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { loadDatabaseConfigFromEnv } from './config.js'
import * as schema from './schema.js'

let dbInstance: ReturnType<typeof drizzle> | null = null
let poolInstance: ReturnType<typeof mysql.createPool> | null = null

export function getDb(): ReturnType<typeof drizzle> {
  if (dbInstance) {
    return dbInstance
  }

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
  dbInstance = drizzle({ client: poolInstance, schema, mode: 'default' })

  return dbInstance
}

export async function closeDb() {
  if (poolInstance) {
    await poolInstance.end()
    poolInstance = null
    dbInstance = null
  }
}

export * from './schema.js'
export * from './helpers.js'
