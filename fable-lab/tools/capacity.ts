/**
 * capacity.ts — live fleet capacity snapshot for sizing batch submissions
 * (charter constraint 3: capacity CHANGES; check live counts before sizing,
 * never hardcode. Built in U58 when the fleet-gap patch landed — the
 * FLEET-GAP.md reconciliation plan step 2).
 *
 * Usage: npx tsx fable-lab/tools/capacity.ts [--markets N]
 *
 * Reads the dashboard API at 127.0.0.1:3051 (`/api/workers` — Redis
 * heartbeats grouped by machine; a worker is alive when its heartbeat is
 * < 30 s old, dashboard workers.ts). Prints per-machine alive replay slots (role kind
 * 'worker'), each machine's commit vs the local origin/fable-protocol
 * HEAD (workers lazily self-update to origin on their next job — a stale
 * sha here is NOT an error, but a job submitted now runs on origin HEAD,
 * so the local tree must be committed AND pushed), and with --markets N a
 * wall-clock estimate at the charter's ~1.75s/market throughput anchor.
 *
 * Read-only: no DB write, no queue write, no order of any kind.
 * Exit 1 when the dashboard is unreachable (start it: `npm run dashboard`)
 * or zero slots are alive.
 */
import { execSync } from 'node:child_process'

const API = process.env.FABLE_DASHBOARD_URL ?? 'http://127.0.0.1:3051'
const SEC_PER_MARKET = 1.75 // charter constraint 3 throughput anchor

type WorkerProcess = {
  processKey: string
  role: { kind: string; childId?: number }
  commitSha: string | null
  branchName: string | null
  alive: boolean
}
type MachineGroup = {
  machineId: string
  processes: WorkerProcess[]
  totals: { aliveCount: number }
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  let payload: { machines: MachineGroup[] }
  try {
    const res = await fetch(`${API}/api/workers`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    payload = (await res.json()) as { machines: MachineGroup[] }
  } catch (err) {
    console.error(`capacity: dashboard API unreachable at ${API} (${String(err)}) — start it with: npm run dashboard`)
    process.exit(1)
  }

  let originHead = ''
  try {
    originHead = execSync('git rev-parse origin/fable-protocol', { encoding: 'utf8' }).trim()
  } catch {
    /* origin ref unavailable — staleness column degrades gracefully */
  }

  let slots = 0
  console.log(`fleet capacity (${API}/api/workers, alive = heartbeat < 30 s):`)
  for (const m of payload.machines) {
    const workers = m.processes.filter((p) => p.role.kind === 'worker')
    const alive = workers.filter((p) => p.alive)
    slots += alive.length
    const shas = [...new Set(alive.map((p) => p.commitSha?.slice(0, 7) ?? '?'))]
    const branches = [...new Set(alive.map((p) => p.branchName ?? '?'))]
    const fresh =
      originHead && shas.length === 1 && originHead.startsWith(shas[0])
        ? 'at origin HEAD'
        : 'stale (self-updates on next job)'
    console.log(
      `  ${m.machineId}: ${alive.length}/${workers.length} worker slots alive, ` +
        `branch=${branches.join(',')} sha=${shas.join(',')} ${fresh}`,
    )
  }
  console.log(`TOTAL alive worker slots: ${slots}`)
  if (originHead) console.log(`origin/fable-protocol HEAD: ${originHead.slice(0, 7)} (jobs run on this)`)

  if (slots === 0) {
    console.error('capacity: ZERO alive worker slots — do not submit; check the fleet with the operator')
    process.exit(1)
  }

  const markets = argValue('--markets')
  if (markets && /^\d+$/.test(markets)) {
    const n = Number(markets)
    const sec = (n * SEC_PER_MARKET) / slots
    const wall = sec < 90 ? `${Math.round(sec)}s` : `${(sec / 60).toFixed(1)} min`
    console.log(
      `estimate for ${n} markets: ~${wall} wall ` +
        `(${n} × ${SEC_PER_MARKET}s / ${slots} slots — charter anchor, re-check against real runs)`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
