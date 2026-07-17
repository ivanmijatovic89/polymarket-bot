/**
 * pull-activity.ts — full-history data-api /activity puller for one wallet.
 *
 * The endpoint caps offset at 3000 (max 3500 rows per time window), so we
 * paginate by walking the `end` cursor (unix seconds) backwards: fetch
 * newest-first pages, and when a window is exhausted set end = oldest
 * timestamp seen + 1 (inclusive) and continue. Rows are deduped by a
 * full-row hash so the inclusive boundary never duplicates.
 *
 * Usage:
 *   npx tsx research/gabagool/scripts/pull-activity.ts \
 *     --address 0x... [--out research/gabagool/data] [--start <unixSec>] [--label name]
 *
 * Output: <out>/activity-<label|address>.jsonl (one row per line, as returned)
 * Read-only: only writes inside research/gabagool/data.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
function argOf(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const address = argOf('address')
if (!address) {
  console.error('required: --address 0x...')
  process.exit(1)
}
const outDir = argOf('out') ?? 'research/gabagool/data'
const label = argOf('label') ?? address.toLowerCase()
const startSec = argOf('start') ? Number(argOf('start')) : 0
const maxRows = argOf('max-rows') ? Number(argOf('max-rows')) : Infinity

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, `activity-${label}.jsonl`)
const statePath = join(outDir, `activity-${label}.state.json`)

const BASE = 'https://data-api.polymarket.com/activity'
const LIMIT = 500
const MAX_OFFSET = 3000

type Row = { timestamp: number; [k: string]: unknown }

const seen = new Set<string>()
let total = 0
let endCursor = Number.MAX_SAFE_INTEGER

// resume support: state file stores the last end cursor; the jsonl is append-only
if (existsSync(statePath) && existsSync(outPath)) {
  const st = JSON.parse(readFileSync(statePath, 'utf8'))
  endCursor = st.endCursor
  // rebuild the dedupe set from the file so the inclusive boundary never dupes
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line) continue
    seen.add(createHash('sha1').update(line).digest('hex'))
    total++
  }
  console.log(`resuming: endCursor=${endCursor} total=${total}`)
} else {
  writeFileSync(outPath, '')
}

function rowHash(r: Row): string {
  return createHash('sha1').update(JSON.stringify(r)).digest('hex')
}

async function fetchPage(end: number, offset: number): Promise<Row[]> {
  const url = `${BASE}?user=${address}&limit=${LIMIT}&offset=${offset}${end < Number.MAX_SAFE_INTEGER ? `&end=${end}` : ''}${startSec ? `&start=${startSec}` : ''}`
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      const body = (await res.json()) as Row[] | { error: string }
      if (!Array.isArray(body)) throw new Error(JSON.stringify(body))
      return body
    } catch (e) {
      if (attempt === 5) throw e
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  return []
}

let windowMin = Number.MAX_SAFE_INTEGER

while (total < maxRows) {
  let offset = 0
  let windowRows = 0
  windowMin = Number.MAX_SAFE_INTEGER
  let exhausted = false

  while (offset <= MAX_OFFSET) {
    const page = await fetchPage(endCursor, offset)
    let fresh = 0
    for (const r of page) {
      const h = rowHash(r)
      if (seen.has(h)) continue
      seen.add(h)
      appendFileSync(outPath, JSON.stringify(r) + '\n')
      total++
      fresh++
      if (r.timestamp < windowMin) windowMin = r.timestamp
    }
    windowRows += fresh
    if (page.length < LIMIT) {
      exhausted = true
      break
    }
    offset += LIMIT
    await new Promise((r) => setTimeout(r, 120))
  }

  console.log(
    `window end=${endCursor}: +${windowRows} rows (total ${total}), oldest ${windowMin === Number.MAX_SAFE_INTEGER ? '-' : new Date(windowMin * 1000).toISOString()}`,
  )

  if (exhausted && windowRows === 0) break // truly done
  if (windowMin === Number.MAX_SAFE_INTEGER) break // no rows at all
  if (exhausted && windowMin <= startSec) break

  // next window: inclusive boundary at the oldest second we saw; the row-hash
  // dedupe absorbs the overlap. Keep only boundary-second hashes to bound memory.
  const boundary = windowMin
  endCursor = boundary
  const boundaryHashes: string[] = []
  // (we cannot re-derive which hashes belong to the boundary second without
  // re-reading; keep the whole set — fine for <1M rows)
  writeFileSync(
    statePath,
    JSON.stringify({ endCursor, total, boundaryHashes }, null, 2),
  )
}

writeFileSync(statePath, JSON.stringify({ endCursor, total, done: true }, null, 2))
console.log(`DONE: ${total} rows -> ${outPath}`)
