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

/**
 * Candidate hosts to probe, most authoritative first. A daemon bound to its
 * tailnet address does NOT answer on loopback, and the `tailscale` CLI is
 * often not on PATH on macOS, so the configured bind host from the repo's own
 * env is the reliable source (the probe runs with cwd = repo root).
 */
function candidateHosts() {
  const hosts = []
  try {
    const output = run('/bin/sh', [
      '-c',
      "grep -hE '^GLOBAL_RUNTIME_HOST=' .env .env.* 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'\\''' ",
    ])
    if (output) hosts.push(output.trim())
  } catch {
    // Fall through to the generic candidates.
  }
  hosts.push('127.0.0.1')
  for (const tailscale of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    const ip = run('/bin/sh', [`-c`, `${tailscale} ip -4 2>/dev/null | head -1`])
    if (ip) hosts.push(ip.trim())
  }
  return [...new Set(hosts.filter(Boolean))]
}

// /health is intentionally unauthenticated, so the probe needs no token.
async function probeHealth() {
  for (const host of candidateHosts()) {
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
