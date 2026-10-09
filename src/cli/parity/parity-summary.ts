import { writeFileSync } from 'node:fs'
import { one, parseArgv } from '../../backtest/parity/cliArgs.js'
import { fileSha256, readManifest, renderSummary } from '../../backtest/parity/manifest.js'

const USAGE = `Usage:
  npm run native:parity:summary -- <manifest.json>... [--out <file.md>]

Renders the PARITY.md matrix status and the gate evidence tables from parity
manifests (native/spec/60-verification.md HR-7, §15.2). Every table names the
sha256 of the manifest it comes from; numbers are never typed by hand.`

async function main(): Promise<number> {
  const p = parseArgv(process.argv.slice(2), { values: ['out'], switches: ['help'] })
  if (p.switches.has('help') || p.positionals.length === 0) {
    console.error(USAGE)
    return p.switches.has('help') ? 0 : 2
  }
  const items = []
  for (const file of p.positionals)
    items.push({ file, sha256: await fileSha256(file), manifest: readManifest(file) })
  const md = renderSummary(items)
  const out = one(p, 'out')
  if (out) writeFileSync(out, md)
  else process.stdout.write(md)
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    console.error(`[parity-summary] ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 2
  })
