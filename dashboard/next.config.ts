import type { NextConfig } from 'next'
import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

// Load the bot's root .env so dashboard sees the same DB/Redis credentials
// without duplicating .env files. Local dashboard/.env (if any) still wins
// because Next loads it after this.
loadDotenv({ path: resolve(__dirname, '..', '.env') })

const nextConfig: NextConfig = {
  // Server-only packages — keep ioredis/mysql2/bullmq out of the client bundle.
  serverExternalPackages: ['ioredis', 'mysql2', 'bullmq', 'drizzle-orm'],
}

export default nextConfig
