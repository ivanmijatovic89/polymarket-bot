#!/usr/bin/env node
/**
 * fleet-status probe — runs ON each machine, prints ONE JSON line describing
 * it: git state, worker/converter tmux sessions, cores, free disk, and a
 * per-dataset inventory (same directories data:sync reports).
 *
 * Plain Node, zero dependencies (no tsx, no npm install needed) so the
 * status playbook can run it on any provisioned worker cheaply.
 *
 * Usage: node scripts/fleet-status-probe.mjs   (from the repo root)
 * Consumed by: ops/ansible/status-workers.yml (npm run fleet:status)
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

const tmuxBin = process.env.FLEET_TMUX_BIN?.trim() || 'tmux'
const backtestWorkerSession =
  process.env.FLEET_BACKTEST_WORKER_SESSION?.trim() || 'polymarket-backtest-worker'

function tmuxSession(name) {
  const out = run(tmuxBin, ['list-panes', '-t', name, '-F', '#{pane_id}'])
  if (out == null) return { alive: false, panes: 0 }
  return { alive: true, panes: out.split('\n').filter(Boolean).length }
}

/** Count parquet files + newest filename in a flat directory. */
function dirInventory(dir) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.parquet'))
      .sort()
    return { files: files.length, newest: files.length > 0 ? files[files.length - 1] : null }
  } catch {
    return { files: 0, newest: null }
  }
}

/** List subdirectories of a directory (empty list when absent). */
function subdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

const repo = process.cwd()

const git = {
  branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
  commit: run('git', ['rev-parse', '--short', 'HEAD']),
  dirty: (run('git', ['status', '--porcelain', '--untracked-files=no']) ?? '') !== '',
}

const dfOut = run('df', ['-k', repo])
let diskFreeGb = null
if (dfOut != null) {
  const line = dfOut.split('\n').at(-1)
  const cols = line == null ? [] : line.trim().split(/\s+/)
  const availKb = Number(cols[3])
  if (Number.isFinite(availKb)) diskFreeGb = Math.round(availKb / 1024 / 1024)
}

const datasets = { converted: {}, binanceAggTrades: {}, cryptoPrices: {} }

const convertedRoot = path.join(repo, 'data', 'events', 'telonex', 'delta-typed')
for (const sym of subdirs(convertedRoot)) {
  for (const tf of subdirs(path.join(convertedRoot, sym))) {
    datasets.converted[`${sym}:${tf}`] = dirInventory(path.join(convertedRoot, sym, tf))
  }
}

const binanceRoot = path.join(repo, 'data', 'binance', 'aggTrades')
for (const pair of subdirs(binanceRoot)) {
  datasets.binanceAggTrades[pair] = dirInventory(path.join(binanceRoot, pair))
}

const cpRoot = path.join(repo, 'data', 'telonex', 'crypto_prices')
for (const asset of subdirs(cpRoot)) {
  if (asset === 'recordings') continue
  datasets.cryptoPrices[asset] = dirInventory(path.join(cpRoot, asset))
}

const status = {
  host: os.hostname(),
  probedAt: new Date().toISOString(),
  git,
  cores: os.cpus().length,
  diskFreeGb,
  sessions: {
    backtestWorker: tmuxSession(backtestWorkerSession),
    telonexConverter: tmuxSession('polymarket-telonex-converter'),
  },
  datasets,
}

console.log(JSON.stringify(status))
