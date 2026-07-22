import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataFormatter = path.join(repo, 'scripts', 'fleet-data-format.mjs')
const statusFormatter = path.join(repo, 'scripts', 'fleet-status-format.mjs')
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
