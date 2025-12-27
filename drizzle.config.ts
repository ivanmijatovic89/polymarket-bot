import { defineConfig } from 'drizzle-kit'

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : undefined
}

const databaseUrl = env('DATABASE_URL')
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
})
