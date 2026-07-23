import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataFormatter = path.join(repo, 'scripts', 'fleet-data-format.mjs')
const dataWrapper = path.join(repo, 'scripts', 'fleet-data.sh')
const statusFormatter = path.join(repo, 'scripts', 'fleet-status-format.mjs')
const statusProbe = path.join(repo, 'scripts', 'fleet-status-probe.mjs')
const lockLibrary = path.join(repo, 'scripts', 'lib', 'fleet-lock.sh')

function runFormatter(script, rows) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fleet-formatter-test-'))
  const input = path.join(dir, 'input.json')
  writeFileSync(input, JSON.stringify(rows))
  const result = spawnSync(process.execPath, [script, input], { encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  return result
}

function successfulSummary(step) {
  return ['[data:sync] summary:', `  OK      ${step}  0.1s  — to-download=0`]
}

test('real fleet data sync returns non-zero when a worker command failed', () => {
  const result = runFormatter(dataFormatter, [
    {
      host: 'worker-1',
      dryRun: false,
      producer: null,
      worker: { rc: 2, stdoutLines: [] },
    },
  ])

  assert.equal(result.status, 1)
  assert.match(result.stdout, /FLEET DATA SYNC FAILED/)
  assert.match(result.stdout, /worker-1:worker/)
})

test('dual-role fleet data sync renders producer and worker independently', () => {
  const result = runFormatter(dataFormatter, [
    {
      host: 'combo-1',
      dryRun: true,
      producer: { rc: 0, stdoutLines: successfulSummary('producer-check') },
      worker: { rc: 0, stdoutLines: successfulSummary('worker-check') },
    },
  ])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /PRODUCER vs upstream/)
  assert.match(result.stdout, /WORKERS vs R2/)
  assert.equal(result.stdout.match(/combo-1/g)?.length, 2)
})

test('fleet status distinguishes unreachable hosts from probe failures', () => {
  const result = runFormatter(statusFormatter, [
    {
      host: 'offline-1',
      role: 'worker',
      status: null,
      probe: { unreachable: true, rc: null, error: 'connection timed out' },
    },
    {
      host: 'broken-1',
      role: 'worker',
      status: null,
      probe: { unreachable: false, rc: 127, error: 'node: command not found' },
    },
  ])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /offline-1\s+worker\s+✗ unreachable/)
  assert.match(result.stdout, /broken-1\s+worker\s+✗ probe failed rc=127: node: command not found/)
})

test('fleet status probe honors the configured tmux binary and worker session', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fleet-status-probe-test-'))
  const fakeTmux = path.join(dir, 'tmux-custom')
  writeFileSync(
    fakeTmux,
    [
      '#!/usr/bin/env bash',
      'if [ "${1:-}" = list-panes ] && [ "${3:-}" = custom-worker ]; then',
      "  printf '#1\\n#2\\n'",
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'),
  )
  chmodSync(fakeTmux, 0o755)

  const result = spawnSync(process.execPath, [statusProbe], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      FLEET_BACKTEST_WORKER_SESSION: 'custom-worker',
      FLEET_TMUX_BIN: fakeTmux,
    },
  })

  assert.equal(result.status, 0, result.stderr)
  const status = JSON.parse(result.stdout)
  assert.deepEqual(status.sessions.backtestWorker, { alive: true, panes: 2 })
  assert.deepEqual(status.sessions.telonexConverter, { alive: false, panes: 0 })
  rmSync(dir, { recursive: true, force: true })
})

test('fleet data wrapper allocates a separate recap file for every invocation', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fleet-data-wrapper-test-'))
  const binDir = path.join(dir, 'bin')
  const inventory = path.join(dir, 'inventory.ini')
  const outputLog = path.join(dir, 'recap-paths.txt')
  mkdirSync(binDir)
  writeFileSync(inventory, '[backtest_workers]\nworker-1\n')

  const fakeAnsible = path.join(binDir, 'ansible-playbook')
  writeFileSync(
    fakeAnsible,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'output=',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = -e ] && [ "$#" -ge 2 ]; then',
      '    case "$2" in',
      '      fleet_data_output=*) output="${2#fleet_data_output=}" ;;',
      '    esac',
      '    shift 2',
      '  else',
      '    shift',
      '  fi',
      'done',
      '[ -n "$output" ]',
      'printf \'%s\\n\' "$output" >> "$FAKE_ANSIBLE_LOG"',
      `printf '%s\\n' '${JSON.stringify([
        {
          host: 'worker-1',
          dryRun: false,
          producer: null,
          worker: { rc: 0, stdoutLines: successfulSummary('converted') },
        },
      ])}' > "$output"`,
      '',
    ].join('\n'),
  )
  chmodSync(fakeAnsible, 0o755)

  const env = {
    ...process.env,
    ANSIBLE_INVENTORY: inventory,
    FAKE_ANSIBLE_LOG: outputLog,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  }
  const first = spawnSync('bash', [dataWrapper, 'btc:15m'], { cwd: repo, encoding: 'utf8', env })
  const second = spawnSync('bash', [dataWrapper, 'btc:15m'], { cwd: repo, encoding: 'utf8', env })

  assert.equal(first.status, 0, first.stderr)
  assert.equal(second.status, 0, second.stderr)
  const recapPaths = readFileSync(outputLog, 'utf8').trim().split('\n')
  assert.equal(recapPaths.length, 2)
  assert.notEqual(recapPaths[0], recapPaths[1])
  assert.equal(existsSync(recapPaths[0]), false, 'first recap should be removed by the exit trap')
  assert.equal(existsSync(recapPaths[1]), false, 'second recap should be removed by the exit trap')
  rmSync(dir, { recursive: true, force: true })
})

function runLock(lockDir) {
  return spawnSync(
    'bash',
    ['-c', 'set -euo pipefail; source "$1"; acquire_fleet_lock test-command', 'bash', lockLibrary],
    {
      encoding: 'utf8',
      env: { ...process.env, FLEET_LOCK_DIR: lockDir },
    },
  )
}

test('fleet lock fails closed when owner metadata is incomplete', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fleet-lock-test-'))
  const lockDir = path.join(dir, 'lock')
  mkdirSync(lockDir)

  const result = runLock(lockDir)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /without owner metadata/)
  rmSync(dir, { recursive: true, force: true })
})

test('fleet lock safely reclaims a lock owned by a dead process', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fleet-lock-test-'))
  const lockDir = path.join(dir, 'lock')
  mkdirSync(lockDir)
  writeFileSync(path.join(lockDir, 'pid'), '999999999\n')
  writeFileSync(path.join(lockDir, 'label'), 'dead-command\n')

  const result = runLock(lockDir)

  assert.equal(result.status, 0)
  assert.match(result.stderr, /reclaiming stale lock/)
  assert.equal(existsSync(lockDir), false, 'the exit trap should release the reclaimed lock')
  rmSync(dir, { recursive: true, force: true })
})
