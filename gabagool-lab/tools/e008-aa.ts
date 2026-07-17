/**
 * e008-aa.ts — E008 A/A determinism check (LEDGER §E008 implementation
 * plan): every market of the smoke run (new SHA, fvGateMode=none) must
 * reproduce run 708's per-market EL EXACTLY on the same slug. Any
 * mismatch = the ref reuse basis is broken → STOP.
 *
 * Usage: npx tsx gabagool-lab/tools/e008-aa.ts --smoke 723 --ref 708
 */
import { closeDb, computeMarketEcon, loadMarketRows } from './lib.js'

const arg = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : dflt
}
const smokeId = arg('--smoke', 723)
const refId = arg('--ref', 708)

async function main(): Promise<void> {
  const smoke = await loadMarketRows(smokeId)
  const ref = await loadMarketRows(refId)
  const refBySlug = new Map(ref.map((m) => [m.slug, m]))
  let ok = 0
  let bad = 0
  for (const m of smoke) {
    const r = refBySlug.get(m.slug)
    if (!r) {
      console.log(`MISSING in ref: ${m.slug}`)
      bad++
      continue
    }
    const a = computeMarketEcon(m).el
    const b = computeMarketEcon(r).el
    if (a === b) ok++
    else {
      console.log(`MISMATCH ${m.slug}: smoke ${a} vs ref ${b} (Δ ${(a - b).toExponential(3)})`)
      bad++
    }
  }
  console.log(`\nA/A: ${ok}/${smoke.length} exact, ${bad} mismatches → ${bad === 0 ? 'PASS' : 'FAIL'}`)
  await closeDb()
  if (bad > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
