// Entry point of `npm run native:fixture-job -- <fixture slug>` (60 §12 FX-1a,
// 01 §6 M1 proof); the logic lives in src/native/fixtureJob.ts so CI
// typechecks and lints it.
import { fixtureJobMain } from '../../src/native/fixtureJob.js'

fixtureJobMain(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`[native:fixture-job] ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 2
})
