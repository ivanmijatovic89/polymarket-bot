/**
 * validate-experiment.ts — mechanical bias protection (LIFECYCLE.md §2).
 *
 * Checks a pre-registered experiment spec for completeness, and (optionally)
 * checks a run against the spec:
 *  - all spec fields filled, no template placeholders left
 *  - strategy file exists and exports a definition with the declared id
 *  - with --run <id>: run's strategy/params match the spec's primary cell,
 *    the run's batchUid carries the experiment id, and the spec file's FIRST
 *    git commit predates the run's creation (results cannot precede the spec)
 *  - holdout discipline: at most one run labeled `<EXP>-holdout` exists
 *
 * Read-only. Exit code 1 on any violation.
 *
 * Usage:
 *   npx tsx fable-lab/tools/validate-experiment.ts <EXP-012 | path> [--run <id>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { like } from 'drizzle-orm'
import { parseSpecFile, resolveSpecPath } from './lib/spec.js'
import { getDb, closeDb, backtestRuns } from '../../src/db/index.js'
import { getBacktestRunById } from '../../src/db/backtests.js'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const problems: string[] = []
const warnings: string[] = []
function bad(msg: string) {
  problems.push(msg)
}

async function main() {
  const target = process.argv[2]
  if (!target || target.startsWith('--')) {
    throw new Error('usage: validate-experiment.ts <EXP-id-or-path> [--run <id>]')
  }
  const specPath = resolveSpecPath(target)
  const spec = parseSpecFile(specPath)

  // --- spec completeness ---
  if (!spec.expId) bad('missing "# EXP-NNN — title" header')
  if (!spec.registered) bad('missing Registered field')
  if (spec.lineageCells == null) bad('missing lineage_cells')
  if (!spec.mechanismClass) bad('missing Mechanism class')
  if (!spec.hypothesis) bad('missing Hypothesis')
  if (!spec.prediction) bad('missing Falsifiable prediction')
  if (!spec.strategyId) bad('missing strategy id (expected: id `fable-exp-NNN`)')
  if (!spec.strategyPath) bad('missing strategy path')
  if (spec.primaryParams.length === 0) {
    warnings.push('primary cell declares no --param pairs (ok only if strategy has no params)')
  }
  if (spec.holdoutBoundaryMs == null) bad('missing holdout boundary (Holdout: `market_start_ms` >= <ms>)')
  if (!spec.simulatorBias) bad('missing simulator-bias exposure statement')
  if (spec.unresolvedPlaceholders.length > 0) {
    bad(`unresolved template placeholders: ${spec.unresolvedPlaceholders.join(', ')}`)
  }

  // --- strategy file ---
  if (spec.strategyPath) {
    if (!existsSync(spec.strategyPath)) {
      bad(`strategy file not found: ${spec.strategyPath}`)
    } else {
      const src = readFileSync(spec.strategyPath, 'utf8')
      if (!/^export\s+const\s+definition\b/m.test(src)) {
        bad(`strategy file has no "export const definition": ${spec.strategyPath}`)
      }
      if (spec.strategyId && !src.includes(`'${spec.strategyId}'`) && !src.includes(`"${spec.strategyId}"`)) {
        bad(`strategy file does not contain declared id ${spec.strategyId}`)
      }
    }
  }

  // --- run cross-checks ---
  const runIdArg = argValue('--run')
  if (runIdArg) {
    const run = await getBacktestRunById(Number(runIdArg))
    if (!run) {
      bad(`run ${runIdArg} not found`)
    } else {
      if (spec.strategyId && run.strategy !== spec.strategyId) {
        bad(`run strategy ${run.strategy} != spec ${spec.strategyId}`)
      }
      if (spec.expId && !String(run.batchUid).startsWith(spec.expId)) {
        bad(`run batchUid "${run.batchUid}" does not start with ${spec.expId}`)
      }
      const runParams = (run.params ?? {}) as Record<string, unknown>
      for (const pair of spec.primaryParams) {
        const [k, v] = pair.split('=', 2)
        const actual = runParams[k]
        if (actual === undefined) {
          bad(`spec param ${k}=${v} missing from run params`)
        } else if (String(actual) !== v) {
          bad(`spec param ${k}=${v} but run has ${k}=${String(actual)}`)
        }
      }
      // spec-before-results: first commit touching the spec file vs run creation
      try {
        const out = execFileSync(
          'git',
          ['log', '--follow', '--format=%ct', '--reverse', '--', specPath],
          { encoding: 'utf8' },
        ).trim()
        const firstCommitSec = Number(out.split('\n')[0])
        if (!out || Number.isNaN(firstCommitSec)) {
          bad('spec file has no git history — commit the spec before running')
        } else if (run.createdAt && firstCommitSec * 1000 > new Date(run.createdAt).getTime()) {
          bad(
            `spec first committed ${new Date(firstCommitSec * 1000).toISOString()} AFTER run created ${new Date(run.createdAt).toISOString()} — results precede the spec`,
          )
        }
      } catch (e) {
        bad(`git history check failed: ${(e as Error).message}`)
      }
    }
  }

  // --- holdout discipline ---
  if (spec.expId) {
    const db = getDb()
    const holdoutRuns = await db
      .select({ id: backtestRuns.id, batchUid: backtestRuns.batchUid })
      .from(backtestRuns)
      .where(like(backtestRuns.batchUid, `${spec.expId}-holdout%`))
    if (holdoutRuns.length > 1) {
      bad(`holdout burned: ${holdoutRuns.length} runs labeled ${spec.expId}-holdout* (${holdoutRuns.map((r) => r.id).join(', ')})`)
    }
  }

  for (const w of warnings) console.log(`WARN  ${w}`)
  if (problems.length === 0) {
    console.log(`OK    ${specPath} passes validation`)
  } else {
    for (const p of problems) console.log(`FAIL  ${p}`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => closeDb())
