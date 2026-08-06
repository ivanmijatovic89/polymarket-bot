#!/usr/bin/env node
/**
 * Global Runtime status probe — runs ON each machine, prints ONE JSON line:
 * tmux session state, daemon /health, git sha of the checkout. Zero
 * dependencies (plain Node) so ansible can push+run it on any machine.
 *
 * Usage: node scripts/global-runtime-status-probe.mjs   (from the repo root)
 * Consumed by: ops/ansible/global-runtime-status.yml (npm run fleet:runtime:status)
 */

import { execFileSync } from 'node:child_process'

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

const tmuxBin = process.env.FLEET_TMUX_BIN?.trim() || 'tmux'
const sessionName = process.env.FLEET_GLOBAL_RUNTIME_SESSION?.trim() || 'polymarket-global-runtime'
const port = Number(process.env.FLEET_GLOBAL_RUNTIME_PORT?.trim() || 3053)

const sessionAlive = run(tmuxBin, ['list-panes', '-t', sessionName, '-F', '#{pane_id}']) !== null

// /health is intentionally unauthenticated, and the daemon may bind either
// loopback or the tailnet address — try loopback first (probe runs on-host).
async function probeHealth() {
  for (const host of ['127.0.0.1', run('/bin/sh', ['-c', 'tailscale ip -4 2>/dev/null']) ?? '']) {
    if (!host) continue
    try {
      const response = await fetch(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      const body = await response.json().catch(() => null)
      return { reachable: true, host, status: response.status, ok: body?.ok === true }
    } catch {
      // Try the next candidate address.
    }
  }
  return { reachable: false, host: null, status: null, ok: false }
}

const health = await probeHealth()

process.stdout.write(
  JSON.stringify({
    session: { name: sessionName, alive: sessionAlive },
    health,
    git: {
      sha: run('git', ['rev-parse', '--short', 'HEAD']),
      branch: run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    },
  }) + '\n',
)
