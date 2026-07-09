/**
 * submit.ts — build (and optionally execute) the exact backtest command for
 * an experiment stage, from the frozen spec. Exists so run parameters cannot
 * drift from what was registered (LIFECYCLE.md §3).
 *
 * Prints the command by default; --execute runs it in the foreground.
 * Scope flags are operator-fixed (CHARTER) and not configurable here.
 *
 * Stages:
 *   smoke    --sequential --limit 10, batchUid EXP-NNN-smoke (never evidence)
 *   probe    --random --limit 500 within the exploration window
 *   main     --extend <probe run> up to the holdout boundary. NOTE: extension
 *            keeps the parent's batchUid — the grown run stays labeled
 *            EXP-NNN-probe and is addressed by run id.
 *   lat      latency-curve point: like probe's window but full exploration
 *            selection is NOT re-run — a lat run mirrors the MAIN window with
 *            BACKTEST_LATENCY_DELAY=<ms> BACKTEST_LATENCY_JITTER=0.
 *            Requires --delay <ms>. batchUid EXP-NNN-lat<ms>.
 *   grid     robustness neighborhood cell: primary params overridden by
 *            --cell "k=v k2=v2". batchUid EXP-NNN-grid-<k-v-...>.
 *   holdout  one-shot, frozen window [boundary, regLast]. --execute refuses
 *            to run unless validate-experiment.ts passes.
 *
 * Usage:
 *   npx tsx fable-lab/tools/submit.ts <EXP-012 | path> --stage <stage> [options]
 *     --parent-run <id>   (main) probe run to extend
 *     --delay <ms>        (lat) latency delay point
 *     --cell "k=v k2=v2"  (grid) parameter cell override
 *     --limit <n>         override stage default limit
 *     --execute           actually run the command (default: print only)
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSpecFile, resolveSpecPath } from './lib/spec.js'

const HERE = dirname(fileURLToPath(import.meta.url))

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const SCOPE_FLAGS = [
  '--input-mode', 'telonex-delta',
  '--read-from', 'local-or-download-from-r2-to-local',
  '--symbol', 'btc',
  '--timeframe', '15m',
]
const STAGES = ['smoke', 'probe', 'main', 'lat', 'grid', 'holdout'] as const

function main() {
  const target = process.argv[2]
  const stage = argValue('--stage') as (typeof STAGES)[number] | undefined
  if (!target || !stage || !STAGES.includes(stage)) {
    throw new Error(`usage: submit.ts <EXP-id-or-path> --stage ${STAGES.join('|')} [options]`)
  }
  const specPath = resolveSpecPath(target)
  const spec = parseSpecFile(specPath)
  if (!spec.expId || !spec.strategyId) {
    throw new Error(`spec is incomplete (expId=${spec.expId}, strategyId=${spec.strategyId}) — run validate-experiment.ts first`)
  }
  if (stage !== 'smoke' && spec.holdoutBoundaryMs == null) {
    throw new Error('spec has no holdout boundary — cannot build a window-bounded command')
  }

  const env: Record<string, string> = {}
  const params = spec.primaryParams.flatMap((p) => ['--param', p])
  const args: string[] = ['run', 'backtest', '--']

  if (stage === 'main') {
    const parent = argValue('--parent-run')
    if (!parent) throw new Error('--stage main requires --parent-run <probe runId>')
    // extension keeps the parent's batchUid (EXP-NNN-probe); address by run id
    args.push('--extend', parent, '--to-ms', String(spec.holdoutBoundaryMs))
  } else if (stage === 'smoke') {
    args.push('--strategy', spec.strategyId, ...params, ...SCOPE_FLAGS)
    args.push('--sequential', '--limit', argValue('--limit') ?? '10', '--batchUid', `${spec.expId}-smoke`)
  } else if (stage === 'probe') {
    args.push('--strategy', spec.strategyId, ...params, ...SCOPE_FLAGS)
    args.push(
      '--random', '--limit', argValue('--limit') ?? '500',
      '--to-ms', String(spec.holdoutBoundaryMs),
      '--batchUid', `${spec.expId}-probe`,
    )
  } else if (stage === 'lat') {
    const delay = argValue('--delay')
    if (!delay || !/^\d+$/.test(delay)) throw new Error('--stage lat requires --delay <ms>')
    env.BACKTEST_LATENCY_DELAY = delay
    env.BACKTEST_LATENCY_JITTER = '0'
    args.push('--strategy', spec.strategyId, ...params, ...SCOPE_FLAGS)
    args.push(
      '--to-ms', String(spec.holdoutBoundaryMs),
      '--limit', argValue('--limit') ?? '1000000',
      '--batchUid', `${spec.expId}-lat${delay}`,
    )
  } else if (stage === 'grid') {
    const cell = argValue('--cell')
    if (!cell) throw new Error('--stage grid requires --cell "k=v k2=v2"')
    const cellPairs = cell.trim().split(/\s+/)
    const cellParams = cellPairs.flatMap((p) => ['--param', p])
    const cellSlug = cellPairs.join('-').replace(/[^A-Za-z0-9._-]/g, '-')
    args.push('--strategy', spec.strategyId, ...cellParams, ...SCOPE_FLAGS)
    args.push(
      '--to-ms', String(spec.holdoutBoundaryMs),
      '--limit', argValue('--limit') ?? '1000000',
      '--batchUid', `${spec.expId}-grid-${cellSlug}`,
    )
  } else if (stage === 'holdout') {
    if (spec.holdoutEndMs == null) {
      throw new Error(
        'spec has no frozen holdout UPPER bound (expected "Holdout: `market_start_ms` >= <ms> and <= <ms>") — the window must not grow after registration',
      )
    }
    args.push('--strategy', spec.strategyId, ...params, ...SCOPE_FLAGS)
    // explicit large --limit: the eligibility query defaults to 1000 rows,
    // which would silently truncate the holdout window
    args.push(
      '--from-ms', String(spec.holdoutBoundaryMs),
      '--to-ms', String(spec.holdoutEndMs),
      '--limit', argValue('--limit') ?? '1000000',
      '--batchUid', `${spec.expId}-holdout`,
    )
  }

  const envPrefix = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  const printable = [envPrefix, ['npm', ...args].map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ')]
    .filter(Boolean)
    .join(' ')
  console.log(printable)

  if (process.argv.includes('--execute')) {
    if (stage === 'holdout') {
      // holdout is one-shot and burnable — mechanically enforce validation
      const check = spawnSync('npx', ['tsx', join(HERE, 'validate-experiment.ts'), specPath], {
        stdio: 'inherit',
      })
      if (check.status !== 0) {
        console.error('REFUSED: validate-experiment.ts failed — holdout not submitted')
        process.exitCode = 1
        return
      }
    }
    const res = spawnSync('npm', args, { stdio: 'inherit', env: { ...process.env, ...env } })
    process.exitCode = res.status ?? 1
  }
}

main()
