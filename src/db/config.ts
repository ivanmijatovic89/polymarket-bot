export type DatabaseConfig = {
  host: string
  port: number
  user: string
  password?: string
  database: string
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : undefined
}

function envRequired(name: string): string {
  const v = env(name)
  if (!v) {
    throw new Error(`${name} environment variable is required`)
  }
  return v
}

export function loadDatabaseConfigFromEnv(): DatabaseConfig {
  const host = envRequired('DATABASE_HOST')
  const portStr = envRequired('DATABASE_PORT')
  const port = parseInt(portStr, 10)
  if (isNaN(port)) {
    throw new Error(`DATABASE_PORT must be a valid number, got: ${portStr}`)
  }
  const user = envRequired('DATABASE_USERNAME')
  const password = env('DATABASE_PASSWORD')
  const database = envRequired('DATABASE_NAME')

  const config: DatabaseConfig = {
    host,
    port,
    user,
    database,
  }

  if (password !== undefined) {
    config.password = password
  }

  return config
}
