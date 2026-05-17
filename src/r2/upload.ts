import '../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getDefaultBucket, headObject, putObject } from './client.js'

type Args = {
  src: string
  prefix: string
  force: boolean
  dryRun: boolean
  ext: string
  concurrency: number
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    src: '',
    prefix: '',
    force: false,
    dryRun: false,
    ext: '.parquet',
    concurrency: 4,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--src') out.src = argv[++i] ?? ''
    else if (a === '--prefix') out.prefix = argv[++i] ?? ''
    else if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--ext') out.ext = argv[++i] ?? '.parquet'
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i] ?? '4'))
    else throw new Error(`[r2:upload] unknown arg: ${a}`)
  }
  if (!out.src) throw new Error('[r2:upload] --src <dir> is required')
  if (!out.prefix) throw new Error('[r2:upload] --prefix <bucket-prefix> is required')
  if (!out.prefix.endsWith('/')) out.prefix += '/'
  return out
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile()) yield full
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const bucket = getDefaultBucket()
  const srcRoot = path.resolve(args.src)
  const srcStat = await fs.stat(srcRoot).catch(() => null)
  if (!srcStat?.isDirectory()) {
    throw new Error(`[r2:upload] --src not a directory: ${srcRoot}`)
  }

  console.log(
    `[r2:upload] src=${srcRoot} -> r2://${bucket}/${args.prefix} ext=${args.ext} force=${args.force} dryRun=${args.dryRun} concurrency=${args.concurrency}`,
  )

  const files: string[] = []
  for await (const file of walk(srcRoot)) {
    if (args.ext && !file.endsWith(args.ext)) continue
    files.push(file)
  }
  console.log(`[r2:upload] found ${files.length} candidate file(s)`)

  let uploaded = 0
  let skipped = 0
  let bytes = 0
  const startedAt = Date.now()
  let nextIdx = 0

  async function worker(workerId: number): Promise<void> {
    while (true) {
      const i = nextIdx++
      if (i >= files.length) return
      const file = files[i]!
      const rel = path.relative(srcRoot, file).split(path.sep).join('/')
      const key = `${args.prefix}${rel}`
      const stat = await fs.stat(file)

      if (!args.force) {
        const existing = await headObject(bucket, key)
        if (existing && existing.size === stat.size) {
          skipped++
          console.log(
            `[r2:upload] w${workerId} skip   r2://${bucket}/${key} (${formatBytes(stat.size)})`,
          )
          continue
        }
      }

      if (args.dryRun) {
        console.log(
          `[r2:upload] w${workerId} would  r2://${bucket}/${key} (${formatBytes(stat.size)})`,
        )
        continue
      }

      const body = await fs.readFile(file)
      await putObject(bucket, key, body)
      uploaded++
      bytes += stat.size
      console.log(
        `[r2:upload] w${workerId} put    r2://${bucket}/${key} (${formatBytes(stat.size)})`,
      )
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, (_, i) => worker(i + 1)))

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
  const mbps = secs !== '0.0' ? (bytes / 1024 / 1024 / Number(secs)).toFixed(2) : '0.00'
  console.log(
    `[r2:upload] done uploaded=${uploaded} skipped=${skipped} bytes=${formatBytes(bytes)} elapsed=${secs}s throughput=${mbps} MB/s`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
