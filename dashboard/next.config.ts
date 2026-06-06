import type { NextConfig } from 'next'
import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

// Load the bot's root .env so dashboard sees the same DB/Redis credentials
// without duplicating .env files. Local dashboard/.env (if any) still wins
// because Next loads it after this.
loadDotenv({ path: resolve(__dirname, '..', '.env') })

function normalizeAllowedDevOrigin(value: string): string | undefined {
  const raw = value.trim()
  if (!raw) return undefined

  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname
  } catch {
    return raw
  }
}

const allowedDevOrigins =
  process.env.DASHBOARD_ALLOWED_DEV_ORIGINS?.split(',')
    .map(normalizeAllowedDevOrigin)
    .filter((origin): origin is string => Boolean(origin)) ?? []

const nextConfig: NextConfig = {
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  // Server-only packages — keep ioredis/mysql2/bullmq out of the client bundle.
  serverExternalPackages: ['ioredis', 'mysql2', 'bullmq', 'drizzle-orm'],
  // With npm workspaces, the symlink for @polymarket-bot/stats is hoisted to
  // the root node_modules. Pin Turbopack's root to the monorepo root so it
  // can resolve the workspace package (and silence the multi-lockfile warning).
  turbopack: {
    root: resolve(__dirname, '..'),
  },
  // `@polymarket-bot/stats` is a sibling workspace package shipped as TS
  // source (no build step) — Next must transpile it like our own src/.
  // Without this, Turbopack treats it as an opaque dep and can't resolve
  // its internal `.js`-suffixed TS imports.
  transpilePackages: ['@polymarket-bot/stats'],
}

export default nextConfig
