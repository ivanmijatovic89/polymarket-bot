import '../config/env.js'
import { closeDb } from '../db/index.js'
import { getBacktestRunByBatchUid, getBacktestRunById } from '../db/backtests.js'

/**
 * Compares two backtest rows by batchUid and reports the first structural diff.
 *
 * Bit-identical means: marketStats (excluding the new optional `execution` field)
 * and run summary columns are deeply equal.
 *
 * Usage:
 *   tsx src/cli/verify-backtest-diff.ts --baseline <uid> --candidate <uid>
 */

function parseArgs(): { baseline: string; candidate: string } {
  const args = process.argv.slice(2)
  let baseline = ''
  let candidate = ''
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--baseline') baseline = args[++i] ?? ''
    else if (a === '--candidate') candidate = args[++i] ?? ''
  }
  if (!baseline || !candidate) {
    console.error('Usage: tsx verify-backtest-diff.ts --baseline <uid> --candidate <uid>')
    process.exit(2)
  }
  return { baseline, candidate }
}

type AnyVal = unknown

function stripExecution(stats: AnyVal): AnyVal {
  if (Array.isArray(stats)) {
    return stats.map(stripExecution)
  }
  if (stats && typeof stats === 'object') {
    const obj = stats as Record<string, AnyVal>
    const out: Record<string, AnyVal> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'execution') continue
      out[k] = stripExecution(v)
    }
    return out
  }
  return stats
}

function diffPath(a: AnyVal, b: AnyVal, path: string, diffs: string[]): void {
  if (diffs.length >= 20) return
  if (a === b) return
  if (typeof a !== typeof b) {
    diffs.push(`${path}: type ${typeof a} vs ${typeof b}`)
    return
  }
  if (a === null || b === null) {
    if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    return
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      diffs.push(`${path}: array vs non-array`)
      return
    }
    if (a.length !== b.length) {
      diffs.push(`${path}: length ${a.length} vs ${b.length}`)
      return
    }
    for (let i = 0; i < a.length; i += 1) {
      diffPath(a[i], b[i], `${path}[${i}]`, diffs)
      if (diffs.length >= 20) return
    }
    return
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, AnyVal>
    const bo = b as Record<string, AnyVal>
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
    for (const k of keys) {
      if (!(k in ao)) diffs.push(`${path}.${k}: missing in baseline`)
      else if (!(k in bo)) diffs.push(`${path}.${k}: missing in candidate`)
      else diffPath(ao[k], bo[k], `${path}.${k}`, diffs)
      if (diffs.length >= 20) return
    }
    return
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return
    if (a !== b) diffs.push(`${path}: ${a} vs ${b}`)
    return
  }
  diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
}

const RUN_SUMMARY_KEYS = [
  'capitalInitial',
  'capitalFinal',
  'pnlTotal',
  'totalFeesPaid',
  'qualitySystem',
  'qualityTrade',
  'evPerMarketPlayed',
  'evPerMarketTotal',
  'marketsTotal',
  'marketsSkipped',
  'marketsNoInWindowActivity',
  'marketsFlatWithTrades',
  'marketsPlayed',
  'marketsWon',
  'marketsLost',
  'winRate',
  'winRatePct',
  'tradesTotal',
  'tradesMaker',
  'tradesTaker',
  'pnlAvgWin',
  'pnlAvgLose',
  'pnlMaxWin',
  'pnlMaxLose',
  'streakMaxWin',
  'streakMaxLose',
  'streakMaxWinPnl',
  'streakMaxLosePnl',
  'streakMaxSkipped',
] as const

function pickRunSummary(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(RUN_SUMMARY_KEYS.map((key) => [key, row[key]]))
}

/**
 * Resolve a run by numeric id or by batch label. Labels are non-unique
 * group names now — getBacktestRunByBatchUid throws when a label matches
 * more than one run, telling the user to pass the run id instead.
 */
async function resolveRun(ref: string) {
  if (/^\d+$/.test(ref)) return getBacktestRunById(Number(ref))
  return getBacktestRunByBatchUid(ref)
}

async function main(): Promise<void> {
  const { baseline, candidate } = parseArgs()
  const base = await resolveRun(baseline)
  const cand = await resolveRun(candidate)

  if (!base) {
    console.error(`baseline run not found: ${baseline} (pass a run id or a batch label)`)
    process.exit(2)
  }
  if (!cand) {
    console.error(`candidate run not found: ${candidate} (pass a run id or a batch label)`)
    process.exit(2)
  }

  console.log(`baseline:  ${baseline}  strategy=${base.strategy}`)
  console.log(`candidate: ${candidate}  strategy=${cand.strategy}`)
  console.log('')

  const sections: Array<{ name: string; a: AnyVal; b: AnyVal }> = [
    {
      name: 'marketStats (excluding execution)',
      a: stripExecution(base.marketStats),
      b: stripExecution(cand.marketStats),
    },
    { name: 'run summary columns', a: pickRunSummary(base), b: pickRunSummary(cand) },
  ]

  let allClean = true
  for (const s of sections) {
    const diffs: string[] = []
    diffPath(s.a, s.b, s.name, diffs)
    if (diffs.length === 0) {
      console.log(`✅ ${s.name}: bit-identical`)
    } else {
      allClean = false
      console.log(
        `❌ ${s.name}: ${diffs.length}${diffs.length >= 20 ? '+ (capped)' : ''} difference(s):`,
      )
      for (const d of diffs) console.log(`     ${d}`)
    }
  }

  // Bonus: report execution presence (sanity check that PR1 populated it)
  const candStats = (cand.marketStats as Array<Record<string, unknown>>) ?? []
  const withExec = candStats.filter((s) => s && typeof s === 'object' && 'execution' in s).length
  console.log('')
  console.log(`candidate marketStats with execution metadata: ${withExec}/${candStats.length}`)

  await closeDb()
  process.exit(allClean ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[verify-backtest-diff] failed:', err)
  await closeDb()
  process.exit(2)
})
