import '../config/env.js'
import { getDefaultBucket, listObjects } from './client.js'
import { formatR2Url } from './parseR2Url.js'

type Args = {
  prefix: string
  ext: string
  urls: boolean
  limit: number | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = { prefix: '', ext: '.parquet', urls: true, limit: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--prefix') out.prefix = argv[++i] ?? ''
    else if (a === '--ext') out.ext = argv[++i] ?? ''
    else if (a === '--keys') out.urls = false
    else if (a === '--limit') out.limit = Number(argv[++i])
    else throw new Error(`[r2:list] unknown arg: ${a}`)
  }
  if (!out.prefix) throw new Error('[r2:list] --prefix <bucket-prefix> is required')
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()
  const objs = await listObjects(bucket, args.prefix)
  let filtered = args.ext ? objs.filter((o) => o.key.endsWith(args.ext)) : objs
  filtered.sort((a, b) => a.key.localeCompare(b.key))
  if (args.limit && filtered.length > args.limit) filtered = filtered.slice(0, args.limit)
  for (const o of filtered) {
    process.stdout.write(`${args.urls ? formatR2Url(bucket, o.key) : o.key}\n`)
  }
  process.stderr.write(
    `[r2:list] count=${filtered.length} bucket=${bucket} prefix=${args.prefix}\n`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
