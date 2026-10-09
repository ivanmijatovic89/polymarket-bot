/**
 * Golden generator (60 §7.1 GF-1/GF-2): runs the real TS telonex-delta replay
 * (`replayTelonexDeltaParquetForMarket`, the oracle for row decode and book
 * semantics, 15 §2.1 and §4.2) over real markets and records, per
 * emitted event, the snapshot timestamp, the event type and the top 3 levels
 * of both assets in file token order. Prices and sizes are written as integer
 * micros. Output: sorted keys, prettier-formatted, header {contentPin,
 * generator, generatorSha256} (contentPin: the oracle pin at which the content
 * last changed, else `git merge-base HEAD origin/main`).
 *
 * Markets are committed fixtures (`source: fixture`, paths relative to
 * `native/fixtures/golden/telonex/`, for example `markets/<slug>.parquet`;
 * always checked, also in CI) or dataset files (`source: data`, relative to
 * `<repo>/data`; checked only where the data exists).
 *
 * Usage (repo root):
 *   npx tsx native/fixtures/gen/telonex_book_gen.ts [--check] [markets/<f>.parquet | <data-relative path>...]
 * Without paths, the markets of the existing golden are regenerated.
 * --check regenerates in memory and fails on any content difference (GF-4);
 * a data market whose file is absent on this host is reported and kept.
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as prettier from 'prettier'
import { replayTelonexDeltaParquetForMarket } from '../../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const dataRoot = path.join(repoRoot, 'data')
const goldenDir = path.join(repoRoot, 'native/fixtures/golden/telonex')
type Source = 'fixture' | 'data'
const sourceOf = (rel: string): Source => (rel.startsWith('markets/') ? 'fixture' : 'data')
const fileOf = (source: Source, rel: string): string =>
  path.join(source === 'fixture' ? goldenDir : dataRoot, rel)
const micros = (v: number): number => Math.round(v * 1e6)

type Lv = { price: number; size: number }
const top = (levels: Lv[] | undefined): string =>
  (levels ?? [])
    .slice(0, 3)
    .map((l) => `${micros(l.price)}:${micros(l.size)}`)
    .join(',')

async function one(source: Source, rel: string) {
  const file = fileOf(source, rel)
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
  return { file: rel, head, rows, sha256: hash.digest('hex'), source, tokens }
}

const GENERATOR = 'native/fixtures/gen/telonex_book_gen.ts'
const target = path.join(goldenDir, 'telonex_book_golden.json')
const check = process.argv.includes('--check')
const previousDoc = existsSync(target)
  ? (JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>)
  : null
type Market = { file: string; source: Source }
const previousMarkets = (previousDoc?.markets ?? []) as Market[]
let files: Market[] = process.argv
  .slice(2)
  .filter((a) => a !== '--check')
  .map((file) => ({ file, source: sourceOf(file) }))
if (files.length === 0) files = previousMarkets.map((m) => ({ file: m.file, source: m.source }))
const markets: unknown[] = []
for (const m of files) {
  if (m.source === 'data' && !existsSync(fileOf(m.source, m.file))) {
    const prev = previousMarkets.find((p) => p.file === m.file && p.source === m.source)
    if (!check || !prev) throw new Error(`${m.file}: absent under ${dataRoot}`)
    console.log(`${m.file}: not checked (no data on this host)`)
    markets.push(prev)
    continue
  }
  markets.push(await one(m.source, m.file))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    )
  }
  return v
}

const body = sortKeys({
  lineFormat:
    'snapshotTs|eventType then per token in first-seen order: bids/asks level counts|top3 bids price:size|top3 asks price:size (micros)',
  markets,
  spec: 'native-spec-g1 15 §2.1, §4.2; 60 §7.2',
}) as Record<string, unknown>
const bodyText = JSON.stringify(body)
let previous: string | null = null
let contentPin = execSync('git merge-base HEAD origin/main', { cwd: repoRoot }).toString().trim()
if (previousDoc) {
  const { header, ...prev } = previousDoc
  previous = JSON.stringify(sortKeys(prev))
  const pin = (header as { contentPin?: string } | undefined)?.contentPin
  if (previous === bodyText && pin) contentPin = pin
}
if (check) {
  if (previous !== bodyText) {
    console.error(`${path.relative(repoRoot, target)}: content differs from the TS oracle`)
    process.exit(1)
  }
  console.log(`${path.relative(repoRoot, target)}: up to date`)
} else {
  const generatorSha256 = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, GENERATOR)))
    .digest('hex')
  const doc = sortKeys({ ...body, header: { contentPin, generator: GENERATOR, generatorSha256 } })
  const options = (await prettier.resolveConfig(target)) ?? {}
  writeFileSync(
    target,
    await prettier.format(JSON.stringify(doc), { ...options, filepath: target }),
  )
  console.log(
    (markets as { file: string; rows: number }[]).map((m) => `${m.file} rows=${m.rows}`).join('\n'),
  )
}
