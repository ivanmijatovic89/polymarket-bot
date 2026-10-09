import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyConditions,
  classifyProcess,
  findOtherWork,
  ownTree,
  parseLsofCwd,
  parsePs,
  parsePsCpuTime,
  PRE_START_SAMPLES,
  servicePids,
  type ConditionInputs,
} from './conditions.js'

const at = (h: number, m = 0): Date => new Date(2026, 9, 10, h, m)

const QUIET: ConditionInputs = {
  quietHostConfirmed: true,
  psChecks: [
    { tMs: 0, phase: 'start', work: [] },
    { tMs: 1000, phase: 'end', work: [] },
  ],
  preStartLoad1: new Array<number>(PRE_START_SAMPLES).fill(0.4),
  rowLoad1: [0.5, 7.9, 8.2],
  maxConcurrency: 8,
  start: at(3),
  end: at(3, 20),
  binariesCanonical: true,
  acPower: true,
  lowPowerMode: false,
  reps: 3,
}

const WORKER = {
  pid: 36689,
  kind: 'fleet-worker' as const,
  args: 'bash ./scripts/run-worker.sh',
  cwd: null,
}

describe('classifyConditions (16 §13.5)', () => {
  it('is idle only when every condition holds', () => {
    assert.deepEqual(classifyConditions(QUIET), { label: 'idle', reasons: [] })
  })

  const cases: Array<[string, Partial<ConditionInputs>, RegExp]> = [
    ['not confirmed', { quietHostConfirmed: false }, /not confirmed/],
    [
      'fleet worker seen at the end only',
      {
        psChecks: [
          { tMs: 0, phase: 'start', work: [] },
          { tMs: 9, phase: 'end', work: [WORKER] },
        ],
      },
      /other work seen by ps \(end\): 1 fleet-worker/,
    ],
    ['no ps check', { psChecks: [] }, /no ps check/],
    ['no pre-start sampling', { preStartLoad1: [] }, /pre-start/],
    ['load too high', { preStartLoad1: [...QUIET.preStartLoad1.slice(1), 1.0] }, /reached 1.00/],
    ['load during the row above T + 1', { rowLoad1: [8, 9.0] }, /during the row \(limit/],
    ['no load during the row', { rowLoad1: [] }, /no load sampling during/],
    ['before window', { start: at(0, 59), end: at(1, 30) }, /started at 00:59/],
    ['after window', { start: at(7), end: at(7, 30) }, /started at 07:00/],
    ['row crosses 07:00', { start: at(6, 59), end: at(7, 4) }, /ended at 07:04/],
    ['non-canonical', { binariesCanonical: false }, /non-canonical/],
    ['battery', { acPower: false }, /not on AC/],
    ['unknown power', { acPower: null }, /unknown/],
    ['low power mode', { lowPowerMode: true }, /Low Power Mode on/],
    ['fewer than 3 repetitions', { reps: 1 }, /off-protocol/],
  ]
  for (const [what, change, reason] of cases) {
    it(`is non-idle when ${what}`, () => {
      const v = classifyConditions({ ...QUIET, ...change })
      assert.equal(v.label, 'non-idle')
      assert.equal(v.reasons.length, 1, v.reasons.join('; '))
      assert.match(v.reasons[0]!, reason)
    })
  }

  it('lists every failing condition', () => {
    const v = classifyConditions({
      ...QUIET,
      quietHostConfirmed: false,
      preStartLoad1: [],
      start: at(12),
      end: at(12, 5),
    })
    assert.equal(v.reasons.length, 3)
  })
})

// Real `ps -Ao pid=,ppid=,args=` lines from worker-1 (2026-10-09). The
// driver tree is a real `npm exec -- tsx` run from the ws-bench worktree:
// its node and esbuild children name fleet-copy paths because node_modules
// is the 01 §8.1 H2 symlink into the fleet copy.
const FLEET_NM = '/Users/worker-1/Sites/polymarket-bot/node_modules'
const NATIVE = '/Users/worker-1/Sites/polymarket-bot-native'
const PS = [
  `    1     0 /sbin/launchd`,
  `  313     1 /opt/homebrew/opt/redis/bin/redis-server 0.0.0.0:6379 `,
  `  314     1 /bin/sh /opt/homebrew/opt/mysql@8.4/bin/mysqld_safe --datadir=/opt/homebrew/var/mysql`,
  ` 1246   314 /opt/homebrew/opt/mysql@8.4/bin/mysqld --basedir=/opt/homebrew/opt/mysql@8.4 --datadir=/opt/homebrew/var/mysql`,
  ` 1265     1 /opt/homebrew/bin/tmux new-session -d -s polymarket-backtest-worker -c /Users/worker-1/Sites/polymarket-bot exec /bin/zsh -lic 'exec ./scripts/run-worker.sh --queues markets,aggregate >> /Users/worker-1/Sites/polymarket-bot/logs/workers/polym`,
  `36689  1265 bash ./scripts/run-worker.sh --queues markets,aggregate --market-concurrency 6`,
  `36955 36689 node ${FLEET_NM}/.bin/tsx src/cli/backtestWorker.ts --queues markets,aggregate --market-concurrency 6`,
  `36956 36955 /Users/worker-1/.nvm/versions/node/v20.20.2/bin/node --require ${FLEET_NM}/tsx/dist/preflight.cjs --import file://${FLEET_NM}/tsx/dist/loader.mjs src/cli/backtestWorker.ts --queues markets,aggregate --market-concurrency 6`,
  `36957 36956 ${FLEET_NM}/tsx/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.27.7 --ping`,
  `28263  1265 npm run global-runtime   `,
  `28535 28263 node ${FLEET_NM}/.bin/tsx src/cli/global-runtime.ts`,
  `85638 85636 /Users/worker-1/.nvm/versions/node/v20.20.2/bin/node --import tsx /Users/worker-1/pmb-rules-capture/app/src/cli/rules-capture-prestart.ts --watch --market btc:5m,btc:15m`,
  ` 1950  1949 node --import tsx ${NATIVE}/.claude/worktrees/ws-ts/src/cli/parity/ts-trace.ts --job /tmp/j.json`,
  ` 2001  2000 /Users/worker-1/.rustup/toolchains/1.89.0-aarch64-apple-darwin/bin/cargo test --workspace --locked`,
  ` 2002  2001 /Users/worker-1/.rustup/toolchains/1.89.0-aarch64-apple-darwin/bin/rustc --crate-name pmb_core --edition=2021`,
  ` 2003  2001 ${NATIVE}/.claude/worktrees/ws-core/native/target/debug/deps/pmb_core-0123456789abcdef`,
  ` 2004  2000 /bin/zsh -c source /Users/worker-1/.claude/shell-snapshots/snapshot-zsh.sh && eval 'grep run-worker.sh cargo test'`,
  `76658 55801 /Users/worker-1/.claude/remote/ccd-cli/2.1.293 --output-format stream-json --allowedTools Bash(cargo test:*)`,
  `18875 76658 /bin/zsh -c source /Users/worker-1/.claude/shell-snapshots/snapshot-zsh-1791538654114-wn9s8t.sh 2>/dev/null || true`,
  `18878 18875 npm exec tsx scripts/native/bench-l1.ts     `,
  `18896 18878 node ${NATIVE}/.claude/worktrees/ws-bench/node_modules/.bin/tsx scripts/native/bench-l1.ts`,
  `18897 18896 /Users/worker-1/.nvm/versions/node/v20.20.2/bin/node --require ${FLEET_NM}/tsx/dist/preflight.cjs --import file://${FLEET_NM}/tsx/dist/loader.mjs scripts/native/bench-l1.ts`,
  `18898 18897 ${FLEET_NM}/tsx/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.27.7 --ping`,
  `18899 18897 ${FLEET_NM}/tsx/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.27.7 --ping`,
  `18900 18897 /usr/bin/time -l -o /tmp/x.time /usr/sbin/taskpolicy -c utility ${NATIVE}/data/strategy-artifacts/native/abc run --job /j.json`,
].join('\n')

describe('process checks (16 §13.5 "ps check recorded")', () => {
  const rows = parsePs(PS)

  it('excludes the driver tree: ancestors, itself and children', () => {
    const own = ownTree(rows, 18897)
    for (const pid of [18896, 18878, 18875, 76658, 18897, 18898, 18899, 18900]) {
      assert.ok(own.has(pid), `pid ${pid} is in the driver tree`)
    }
    assert.ok(!own.has(1) && !own.has(36955))
  })

  it('finds the fleet worker, Global Runtime, parity, builds and tests, by command', () => {
    const work = findOtherWork(rows, 18897)
    assert.deepEqual(
      work.map((w) => [w.pid, w.kind]),
      [
        [36689, 'fleet-worker'],
        [36955, 'fleet-worker'],
        [36956, 'fleet-worker'],
        [28263, 'global-runtime'],
        [28535, 'global-runtime'],
        [1950, 'parity'],
        [2001, 'test'],
        [2002, 'build'],
        [2003, 'test'],
      ],
    )
  })

  it('counts nothing for a quiet host running only the driver and the rules capture', () => {
    // launchd, Redis, MySQL, the tmux server that still names the worker
    // command, the rules capture, an agent shell whose text mentions
    // run-worker.sh and cargo, the agent CLI, and the driver tree.
    const keep = [1, 313, 314, 1246, 1265, 85638, 2004, 76658, 18875, 18878]
    const quiet = rows.filter((r) => keep.includes(r.pid) || (r.pid >= 18896 && r.pid <= 18900))
    assert.deepEqual(findOtherWork(quiet, 18897), [])
  })

  it('classifies command lines', () => {
    const cases: Array<[string, string | null]> = [
      ['npm test', 'test'],
      ['npm run native:bench:test', 'test'],
      ['npm run -s code:typecheck', 'build'],
      ['npm run backtest -- --strategy x', 'backtest'],
      ['npm run trade:bot:btc', 'trading-bot'],
      ['node --test native/bench/harness/a.test.ts', 'test'],
      [`node ${FLEET_NM}/.bin/tsc -p tsconfig.json`, 'build'],
      [`node ${FLEET_NM}/.bin/eslint src`, 'build'],
      [`node ${FLEET_NM}/npm/bin/npm-cli.js run worker:markets`, 'fleet-worker'],
      ['bash scripts/native/ci-local.sh', 'build'],
      ['cargo +1.89.0 bench -p pmb-book', 'test'],
      ['/x/target/release/build/ring-0123/build-script-build', 'build'],
      [`node ${FLEET_NM}/.bin/tsx src/cli/backtest.ts --symbol btc`, 'backtest'],
      ['/opt/homebrew/bin/tmux new-session -d exec ./scripts/run-worker.sh', null],
      ['/bin/zsh -lic exec ./scripts/run-worker.sh', null],
      ['/Applications/Code.app/Contents/MacOS/Electron --cargo', null],
    ]
    for (const [args, kind] of cases) assert.equal(classifyProcess(args), kind, args)
  })

  it('finds the shared services and parses CPU times and cwds', () => {
    assert.deepEqual(servicePids(rows), [
      { pid: 313, name: 'redis-server' },
      { pid: 1246, name: 'mysqld' },
    ])
    assert.equal(parsePsCpuTime('185:45.06'), 11_145_060)
    assert.equal(parsePsCpuTime('1:02:03.50'), 3_723_500)
    assert.equal(parsePsCpuTime('2-00:00:01.00'), 172_801_000)
    assert.throws(() => parsePsCpuTime('x'))
    assert.deepEqual(
      [...parseLsofCwd('p36689\nfcwd\nn/Users/worker-1/Sites/polymarket-bot\n')],
      [[36689, '/Users/worker-1/Sites/polymarket-bot']],
    )
  })
})
