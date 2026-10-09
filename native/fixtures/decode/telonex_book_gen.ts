/**
 * Golden generator (60 §7.1 GF-1/GF-2): runs the real TS telonex-delta replay
 * (`replayTelonexDeltaParquetForMarket`, the oracle for row decode and book
 * semantics, 15 §2.1 and §4.2) over fixture markets and records, per emitted
 * event, the snapshot timestamp, the event type and the top 3 levels of both
 * assets in file token order. Prices and sizes are written as integer micros.
 *
 * Usage: npx tsx native/fixtures/decode/telonex_book_gen.ts <data-relative path>...
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const dataRoot = path.join(repoRoot, 'data')
const micros = (v: number): number => Math.round(v * 1e6)

type Lv = { price: number; size: number }
const top = (levels: Lv[] | undefined): string =>
  (levels ?? [])
    .slice(0, 3)
    .map((l) => `${micros(l.price)}:${micros(l.size)}`)
    .join(',')

async function one(rel: string) {
  const file = path.join(dataRoot, rel)
  const tokens: string[] = []
  const hash = createHash('sha256')
  const head: string[] = []
  let rows = 0
  await replayTelonexDeltaParquetForMarket({
    filePath: file,
    onSnapshot: (snap, raw) => {
      const msg = raw.msg as {
        event_type: string
        asset_id?: string
        price_changes?: { asset_id: string }[]
      }
      const ids =
        msg.event_type === 'book' ? [msg.asset_id!] : msg.price_changes!.map((c) => c.asset_id)
      for (const id of ids) if (!tokens.includes(id)) tokens.push(id)
      const parts = [String(snap.timestamp), msg.event_type]
      for (const id of tokens) {
        const b = snap.byAssetId[id]
        parts.push(`${b?.bids.length ?? 0}/${b?.asks.length ?? 0}`, top(b?.bids), top(b?.asks))
      }
      const line = parts.join('|')
      hash.update(line + '\n')
      if (head.length < 40) head.push(line)
      rows += 1
    },
  })
  return { file: rel, tokens, rows, sha256: hash.digest('hex'), head }
}

const files = process.argv.slice(2)
const markets = []
for (const f of files) markets.push(await one(f))
const out = {
  generator: 'native/fixtures/decode/telonex_book_gen.ts',
  oracleCommit: execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim(),
  spec: 'native-spec-g1 15 §2.1, §4.2; 60 §7.2',
  lineFormat:
    'snapshotTs|eventType then per token in first-seen order: bids/asks level counts|top3 bids price:size|top3 asks price:size (micros)',
  markets,
}
writeFileSync(
  path.join(import.meta.dirname, 'telonex_book_golden.json'),
  JSON.stringify(out, null, 2) + '\n',
)
console.log(markets.map((m) => `${m.file} rows=${m.rows}`).join('\n'))
