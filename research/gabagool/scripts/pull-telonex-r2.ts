/**
 * pull-telonex-r2.ts — download a SAMPLE of Telonex delta-typed converted
 * parquet files from R2 into research/gabagool/data/ (NOT the canonical
 * data/events/telonex/ tree — charter: write only inside research/gabagool/).
 *
 * DB access is READ-ONLY via the sanctioned module (src/db/telonexMarkets).
 *
 * Usage: npx tsx research/gabagool/scripts/pull-telonex-r2.ts \
 *   --symbol btc --timeframe 15m --from <iso> --to <iso> \
 *   [--slugs-file <txt: one slug per line>] [--limit 40] \
 *   [--out research/gabagool/data/telonex-r2]
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listEligibleTelonexMarkets } from '../../../src/db/telonexMarkets.js'
import { downloadR2ToLocal } from '../../../src/telonex/fetchConvertedToLocal.js'
import { isR2Url } from '../../../src/r2/parseR2Url.js'

const args = process.argv.slice(2)
const argOf = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}
const symbol = argOf('symbol') ?? 'btc'
const timeframe = argOf('timeframe') ?? '15m'
const fromMs = Date.parse(argOf('from')!)
const toMs = Date.parse(argOf('to')!)
const limit = Number(argOf('limit') ?? 40)
const outDir = argOf('out') ?? 'research/gabagool/data/telonex-r2'
const slugsFile = argOf('slugs-file')

mkdirSync(outDir, { recursive: true })

const markets = await listEligibleTelonexMarkets({
  symbol,
  timeframe,
  converter: 'delta-typed',
  readFrom: 'r2',
  fromMs,
  toMs,
  limit: 2000,
})
console.log(`eligible r2 markets in window: ${markets.length}`)

let wanted = markets
if (slugsFile) {
  const want = new Set(
    readFileSync(slugsFile, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  wanted = markets.filter((m) => want.has(m.slug))
  console.log(`intersect with slugs-file (${want.size}): ${wanted.length}`)
}
const step = Math.max(1, Math.floor(wanted.length / limit))
const sample = wanted.filter((_, i) => i % step === 0).slice(0, limit)
console.log(`downloading ${sample.length} files -> ${outDir}`)

let done = 0
for (const m of sample) {
  const dest = join(outDir, `${m.slug}.parquet`)
  if (existsSync(dest)) {
    done++
    continue
  }
  if (!m.dataset) continue
  for (let a = 0; a < 4; a++) {
    try {
      if (isR2Url(m.dataset)) {
        // r2:// URIs need the repo's S3 client (R2_* env creds), not fetch.
        await downloadR2ToLocal(m.dataset, resolve(dest))
      } else {
        const res = await fetch(m.dataset)
        if (!res.ok) throw new Error(`http ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(dest + '.tmp', buf)
        renameSync(dest + '.tmp', dest)
      }
      done++
      if (done % 10 === 0) console.log(`  ${done}/${sample.length}`)
      break
    } catch (e) {
      if (a === 3) console.error(`FAILED ${m.slug}: ${e}`)
      await new Promise((r) => setTimeout(r, 800 * (a + 1)))
    }
  }
}
console.log(`DONE: ${done}/${sample.length} on disk`)
process.exit(0)
