/**
 * pull-activity.ts — full-history data-api /activity puller for one wallet.
 *
 * API facts (probed 2026-07-17):
 * - offset caps at 3000 (max 3500 rows per `end` window), sorted newest-first
 * - `end`/`start` are unix SECONDS; `end` is INCLUSIVE
 * - rows have NO unique id and SECOND-granularity timestamps, so two fills
 *   can be byte-identical legitimate rows — NEVER dedupe by row content
 *   (v1 of this script did, silently collapsing same-second identical fills).
 *
 * Correct pagination: fetch a window newest-first; if it exhausts (< limit
 * page), append everything. If it hits the offset cap, the oldest second in
 * the window may be partially fetched — append only rows with ts > that
 * second, then continue with end = that second (inclusive) so it is
 * refetched in full next window.
 *
 * Usage:
 *   npx tsx research/gabagool/scripts/pull-activity.ts \
 *     --address 0x... [--out research/gabagool/data] [--start <unixSec>]
 *     [--label name] [--max-rows N]
 *
 * Output: <out>/activity-<label|address>.jsonl (append-only)
 * State:  <out>/activity-<label|address>.state.json (resume cursor)
 */
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

let total = 0
let endCursor = Number.MAX_SAFE_INTEGER

if (existsSync(statePath) && existsSync(outPath)) {
  const st = JSON.parse(readFileSync(statePath, 'utf8'))
  endCursor = st.endCursor
  // rows with ts <= endCursor may be partial (killed mid-window): drop them
  const kept: string[] = []
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line) continue
    const ts = (JSON.parse(line) as Row).timestamp
    if (ts > endCursor) kept.push(line)
  }
  writeFileSync(outPath, kept.length ? kept.join('\n') + '\n' : '')
  total = kept.length
  console.log(`resuming: endCursor=${endCursor} kept=${total}`)
} else {
  writeFileSync(outPath, '')
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

while (total < maxRows) {
  const windowRows: Row[] = []
  let exhausted = false
  let offset = 0
  while (offset <= MAX_OFFSET) {
    const page = await fetchPage(endCursor, offset)
    windowRows.push(...page)
    if (page.length < LIMIT) {
      exhausted = true
      break
    }
    offset += LIMIT
    await new Promise((r) => setTimeout(r, 120))
  }

  if (windowRows.length === 0) break

  let appended: Row[]
  let nextEnd: number
  const minTs = Math.min(...windowRows.map((r) => r.timestamp))
  if (exhausted) {
    appended = windowRows
    nextEnd = minTs - 1 // window fully consumed; continue strictly older
  } else {
    // offset cap hit: the oldest second may be partial — hold it back
    appended = windowRows.filter((r) => r.timestamp > minTs)
    nextEnd = minTs
    if (appended.length === 0) {
      throw new Error(`>${MAX_OFFSET + LIMIT} rows share second ${minTs}; cannot paginate safely`)
    }
  }

  appendFileSync(outPath, appended.map((r) => JSON.stringify(r)).join('\n') + '\n')
  total += appended.length
  console.log(
    `window end=${endCursor}: +${appended.length} rows (total ${total}), oldest kept ${new Date((exhausted ? minTs : minTs + 1) * 1000).toISOString()}${exhausted ? ' [exhausted]' : ''}`,
  )
  endCursor = nextEnd
  writeFileSync(statePath, JSON.stringify({ endCursor, total }, null, 2))

  if (exhausted && (windowRows.length === 0 || minTs <= startSec)) break
}

writeFileSync(statePath, JSON.stringify({ endCursor, total, done: true }, null, 2))
console.log(`DONE: ${total} rows -> ${outPath}`)
