import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { variants } from './variants.js'

const prefixIndex = process.argv.indexOf('--prefix')
const prefix = prefixIndex >= 0 ? process.argv[prefixIndex + 1] : undefined
if (!prefix || !/^[a-zA-Z0-9_-]{1,100}$/.test(prefix)) {
  throw new Error('Pass --prefix <unique-experiment-name> (letters, digits, dash, underscore)')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const manifest = JSON.parse(
  readFileSync(new URL('./markets-june-2026.json', import.meta.url), 'utf8'),
) as { from: string; slugs: string[] }
if (manifest.slugs.length !== 100 || new Set(manifest.slugs).size !== 100)
  throw new Error('Expected exactly 100 unique market slugs')
const parent = resolve(root, 'data/pair-experiments')
mkdirSync(parent, { recursive: true })
const output = resolve(parent, prefix)
mkdirSync(output)
writeFileSync(resolve(output, 'markets.json'), JSON.stringify(manifest, null, 2) + '\n')
for (const variant of variants) {
  const batchUid = `${prefix}-${variant.id}`
  const args = [
    '--import',
    'tsx',
    'src/cli/backtest.ts',
    '--strategy',
    variant.id,
    '--input-mode',
    'telonex-delta',
    '--read-from',
    'local-or-download-from-r2-to-local',
    '--slug',
    manifest.slugs.join(','),
    '--latency-delay-ms',
    '140',
    '--latency-jitter-ms',
    '0',
    '--batchUid',
    batchUid,
    '--comment',
    'Cross-level pair variants; fixed first 100 BTC 15m markets from June 1 2026 UTC; unchanged normal allocations after repair',
    '--detach',
  ]
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const log = (result.stdout ?? '') + (result.stderr ?? '')
  writeFileSync(resolve(output, `${variant.id}.log`), log)
  if (result.error || result.status !== 0)
    throw new Error(`Submission failed for ${variant.id}; inspect ${output}/${variant.id}.log`, {
      cause: result.error,
    })
  console.log(
    JSON.stringify({ strategy: variant.id, batchUid, log: resolve(output, `${variant.id}.log`) }),
  )
}
