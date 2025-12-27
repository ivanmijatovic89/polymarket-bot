import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { loadDatabaseConfigFromEnv } from './config.js'
import * as schema from './schema.js'

let dbInstance: ReturnType<typeof drizzle> | null = null
let sqlInstance: ReturnType<typeof postgres> | null = null

export function getDb() {
  if (dbInstance) {
    return dbInstance
  }

  const config = loadDatabaseConfigFromEnv()
  sqlInstance = postgres(config.url)
  dbInstance = drizzle(sqlInstance, { schema })

  return dbInstance
}

export function closeDb() {
  if (sqlInstance) {
    sqlInstance.end()
    sqlInstance = null
    dbInstance = null
  }
}

export * from './schema.js'
