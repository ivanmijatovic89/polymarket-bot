import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from './schema'

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>

declare global {
  // eslint-disable-next-line no-var
  var __dashboardDb: DrizzleClient | undefined
}

export function getDb(): DrizzleClient {
  if (globalThis.__dashboardDb) return globalThis.__dashboardDb
  const host = process.env.DATABASE_HOST ?? '127.0.0.1'
  const port = Number(process.env.DATABASE_PORT ?? 3306)
  const user = process.env.DATABASE_USERNAME ?? 'root'
  const password = process.env.DATABASE_PASSWORD
  const database = process.env.DATABASE_NAME
  if (!database) {
    throw new Error('DATABASE_NAME is required (set in .env)')
  }
  const db = drizzle({
    connection: {
      host,
      port,
      user,
      database,
      ...(password !== undefined ? { password } : {}),
    },
    schema,
    mode: 'default',
  })
  globalThis.__dashboardDb = db
  return db
}
