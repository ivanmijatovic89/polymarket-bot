/**
 * play-level.ts — run one level of the game and score it, in one command.
 *
 *   tsx protocols/pair-game-opus/tools/play-level.ts --level 6
 *   tsx protocols/pair-game-opus/tools/play-level.ts --level 6 --param pairCeil=0.95
 *   tsx protocols/pair-game-opus/tools/play-level.ts --level 6 --score-only --run 1080
 *
 * What it does:
 *   1. resolves the level's market universe and quantity (lib/levels.ts);
 *   2. launches run-backtest.ts on EXACTLY those slugs, with `qty` set to the
 *      level's quantity and the RULES latency pins the launcher enforces;
 *   3. scores the persisted run with the level evaluator (level.ts) and exits
 *      0 only on PASS.
 *
 * `qty` is always injected from the level; passing --param qty=… is refused so
 * a run can never be scored against a quantity it was not built for. All other
 * strategy params pass through unchanged.
 *
 * Runs are sequential by default (fast for small levels, valid for unpushed
 * code). --queue submits to the fleet instead; that path requires HEAD to be on
 * origin/main and the launcher enforces it.
 */
import '../../../src/config/env.js'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { openDb } from './lib/runQueries.js'
import { levelSpec, levelSlugs } from './lib/levels.js'
import { scoreLevel, printLevelReport } from './level.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx')
const RUN_BACKTEST = path.join(ROOT, 'protocols', 'pair-game-opus', 'tools', 'run-backtest.ts')

function fail(msg: string): never {
  console.error(`[play-level] ERROR: ${msg}`)
  process.exit(2)
}

const argv = process.argv.slice(2)
let level: number | undefined
let strategy = 'pair-game-opus-pair.v1'
const params: string[] = []
let queue = false
let scoreOnly = false
let runIds: number[] = []
let json = false
let comment: string | undefined
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  switch (a) {
    case '--level':
      level = Number(argv[++i])
      break
    case '--strategy':
      strategy = argv[++i] ?? fail('--strategy requires a value')
      break
    case '--param': {
      const v = argv[++i]
      if (!v || !v.includes('=')) fail('--param expects key=value')
      if (v.startsWith('qty=')) fail('qty is injected from the level; passing it is refused')
      params.push('--param', v)
      break
    }
    case '--comment':
      comment = argv[++i] ?? fail('--comment requires a value')
      break
    case '--queue':
      queue = true
      break
    case '--score-only':
      scoreOnly = true
      break
    case '--run':
      runIds = String(argv[++i] ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
      break
    case '--json':
      json = true
      break
    default:
      fail(`unknown flag '${a}'`)
  }
}
if (level === undefined) fail('--level <positive integer> is required')

const spec = levelSpec(level)
const slugs = await levelSlugs(spec.markets)

if (!scoreOnly) {
  console.error(
    `[play-level] level ${level}: markets=${spec.markets} qty=${spec.qty} strategy=${strategy}`,
  )
  const launchArgs = [
    RUN_BACKTEST,
    '--strategy',
    strategy,
    '--param',
    `qty=${spec.qty}`,
    ...params,
    '--slug',
    slugs.join(','),
    '--label',
    `lvl${level}`,
    '--json',
    ...(comment !== undefined ? ['--comment', comment] : []),
    ...(queue ? [] : ['--sequential']),
  ]
  const child = spawnSync(TSX_BIN, launchArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  })
  let result: { runId?: number | null } | null = null
  try {
    result = JSON.parse(child.stdout || 'null')
  } catch {
    result = null
  }
  if (!result?.runId) fail(`launch produced no run id (launcher exit ${child.status})`)
  runIds = [result.runId]
}

if (runIds.length === 0) fail('--score-only requires --run <id[,id...]>')

const conn = await openDb()
try {
  const report = await scoreLevel(conn, level, runIds)
  if (json) console.log(JSON.stringify(report, null, 2))
  else printLevelReport(report)
  process.exit(report.verdict === 'PASS' ? 0 : 1)
} finally {
  await conn.end()
}
