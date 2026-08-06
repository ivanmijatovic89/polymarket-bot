import '../config/env.js'

// Prints the MySQL endpoint and the Global Runtime bind host resolved through
// the application's env loader, so boot helpers (ops/macos/global-runtime) can
// wait on both without re-implementing .env / BOT_ENV semantics in shell
// (BOT_ENV loads with override, which a raw grep of .env would miss).
// Mirrors resolveRedisEndpoint.ts.
const OUTPUT_MARKER = 'POLYMARKET_DATABASE_ENDPOINT'
const BIND_MARKER = 'POLYMARKET_GLOBAL_RUNTIME_BIND'

const host = process.env.DATABASE_HOST?.trim()
const port = process.env.DATABASE_PORT?.trim() || '3306'

if (!host) {
  console.error(
    '[resolve-database-endpoint] DATABASE_HOST is missing from the effective environment',
  )
  process.exit(75)
}

// The markers let the boot helper ignore harmless output from an interactive
// shell profile. Credentials are never printed.
process.stdout.write(
  `${BIND_MARKER}\t${process.env.GLOBAL_RUNTIME_HOST?.trim() || '127.0.0.1'}\n` +
    `${OUTPUT_MARKER}\t${host}\t${port}\n`,
)
