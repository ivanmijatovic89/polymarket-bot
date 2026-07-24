import '../config/env.js'

const OUTPUT_MARKER = 'POLYMARKET_REDIS_ENDPOINT'

const redisUrl = process.env.REDIS_URL
if (!redisUrl || redisUrl.trim() === '') {
  console.error('[resolve-redis-endpoint] REDIS_URL is missing from the effective environment')
  process.exit(75)
}

let endpoint: URL
try {
  endpoint = new URL(redisUrl)
} catch {
  console.error('[resolve-redis-endpoint] REDIS_URL is not a valid URL')
  process.exit(75)
}

if (endpoint.protocol !== 'redis:' && endpoint.protocol !== 'rediss:') {
  console.error('[resolve-redis-endpoint] REDIS_URL must use redis:// or rediss://')
  process.exit(75)
}

const hostname = endpoint.hostname.replace(/^\[(.*)\]$/, '$1')
const port = endpoint.port || '6379'
if (!hostname) {
  console.error('[resolve-redis-endpoint] REDIS_URL does not contain a hostname')
  process.exit(75)
}

// The marker lets the boot helper ignore harmless output from an interactive
// shell profile. Credentials and the complete Redis URL are never printed.
process.stdout.write(`${OUTPUT_MARKER}\t${hostname}\t${port}\n`)
