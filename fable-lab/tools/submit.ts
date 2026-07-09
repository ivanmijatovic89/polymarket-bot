/**
 * submit.ts — build (and optionally execute) the exact backtest command for
 * an experiment stage, from the frozen spec. Exists so run parameters cannot
 * drift from what was registered (LIFECYCLE.md §3).
 *
 * Prints the command by default; --execute runs it in the foreground.
 * Scope flags are operator-fixed (CHARTER) and not configurable here.
 *
 * Usage:
 *   npx tsx fable-lab/tools/submit.ts <EXP-012 | path> --stage smoke|probe|main|holdout [options]
 *     --stage main requires --parent-run <runId> (extends the probe run)
 *     --execute       actually run the command (default: print only)
 *     --limit <n>     override stage default limit (probe=500, smoke=10)
 */
import { spawnSync } from 'node:child_process'
import { parseSpecFile, resolveSpecPath } from './lib/spec.js'

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

function main() {
  const target = process.argv[2]
  const stage = argValue('--stage')
  if (!target || !stage || !['smoke', 'probe', 'main', 'holdout'].includes(stage)) {
    throw new Error('usage: submit.ts <EXP-id-or-path> --stage smoke|probe|main|holdout [--parent-run <id>] [--limit <n>] [--execute]')
  }
  const spec = parseSpecFile(resolveSpecPath(target))
  if (!spec.expId || !spec.strategyId) {
    throw new Error(`spec is incomplete (expId=${spec.expId}, strategyId=${spec.strategyId}) — run validate-experiment.ts first`)
  }
  if (stage !== 'smoke' && spec.holdoutBoundaryMs == null) {
    throw new Error('spec has no holdout boundary — cannot build a window-bounded command')
  }

  const params = spec.primaryParams.flatMap((p) => ['--param', p])
  const args: string[] = ['run', 'backtest', '--']

  if (stage === 'main') {
    const parent = argValue('--parent-run')
    if (!parent) throw new Error('--stage main requires --parent-run <probe runId>')
    args.push('--extend', parent, '--to-ms', String(spec.holdoutBoundaryMs))
    // extension inherits strategy/params/scope from the parent run
  } else {
    args.push('--strategy', spec.strategyId, ...params, ...SCOPE_FLAGS)
    if (stage === 'smoke') {
      args.push('--sequential', '--limit', argValue('--limit') ?? '10', '--batchUid', `${spec.expId}-smoke`)
    } else if (stage === 'probe') {
      args.push(
        '--random', '--limit', argValue('--limit') ?? '500',
        '--to-ms', String(spec.holdoutBoundaryMs),
        '--batchUid', `${spec.expId}-probe`,
      )
    } else if (stage === 'holdout') {
      args.push('--from-ms', String(spec.holdoutBoundaryMs), '--batchUid', `${spec.expId}-holdout`)
    }
  }

  const printable = ['npm', ...args].map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ')
  console.log(printable)

  if (process.argv.includes('--execute')) {
    if (stage === 'holdout') {
      console.log('NOTE: holdout is one-shot. validate-experiment.ts must pass first; proceeding.')
    }
    const res = spawnSync('npm', args, { stdio: 'inherit' })
    process.exitCode = res.status ?? 1
  }
}

main()
