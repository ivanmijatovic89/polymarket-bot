import '../config/env.js'

// Prints the MySQL endpoint resolved through the application's env loader so
// boot helpers (ops/macos/global-runtime) can nc -z it without re-implementing
// .env / BOT_ENV semantics in shell. Mirrors resolveRedisEndpoint.ts.
const OUTPUT_MARKER = 'POLYMARKET_DATABASE_ENDPOINT'

const host = process.env.DATABASE_HOST?.trim()
const port = process.env.DATABASE_PORT?.trim() || '3306'

if (!host) {
  console.error(
    '[resolve-database-endpoint] DATABASE_HOST is missing from the effective environment',
  )
  process.exit(75)
}

// The marker lets the boot helper ignore harmless output from an interactive
// shell profile. Credentials are never printed.
process.stdout.write(`${OUTPUT_MARKER}\t${host}\t${port}\n`)
