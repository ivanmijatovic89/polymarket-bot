export type DatabaseConfig = {
  url: string
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : undefined
}

export function loadDatabaseConfigFromEnv(): DatabaseConfig {
  const url = env('DATABASE_URL')
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is required. Format: postgresql://user:password@host:port/database',
    )
  }
  return { url }
}

