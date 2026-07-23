import { getRedis } from '../redis'

export type WorkerRole =
  | { kind: 'supervisor' }
  | { kind: 'aggregator' }
  | { kind: 'worker'; childId: number }
  | { kind: 'sequential' }
  | { kind: 'unknown'; raw: string }

export type WorkerProcess = {
  /** Full Redis key suffix, e.g. `8955f8d87c59#3` — unique per process. */
  processKey: string
  /** Parsed role inferred from the suffix after `#`. */
  role: WorkerRole
  commitSha: string | null
  branchName: string | null
  mainCommitSha: string | null
  mainCommitMatch: boolean
  heartbeatAgeMs: number | null
  alive: boolean
  processedTotal: number
  eventsTotal: number
  lastMarket: string | null
  lastFinishedAt: number | null
  /** Queues this process consumes, e.g. 'markets,aggregate' (written by the supervisor heartbeat). */
  queues: string | null
}

export type MachineGroup = {
  machineId: string
  processes: WorkerProcess[]
  /**
   * Queues the (hidden) supervisor process consumes, e.g. 'markets,aggregate'.
   * Supervisor rows are filtered out of `processes` — the machine header
   * represents them — so this is where the UI learns a combined supervisor
   * also aggregates.
   */
  supervisorQueues: string | null
  totals: {
    processedTotal: number
    eventsTotal: number
    aliveCount: number
  }
}

const STALE_WORKER_GRACE_MS = 5 * 60 * 1000

function parseRole(suffix: string): WorkerRole {
  if (suffix === 'supervisor') return { kind: 'supervisor' }
  if (suffix === 'aggregator') return { kind: 'aggregator' }
  if (suffix === 'seq') return { kind: 'sequential' }
  const n = Number(suffix)
  if (Number.isInteger(n) && n >= 1) return { kind: 'worker', childId: n }
  return { kind: 'unknown', raw: suffix }
}

/**
 * Stable sort key inside a machine group: supervisor first, then workers in
 * ascending childId order, sequential next, aggregator last, unknowns after.
 * Aggregator goes last so a stalled-looking 0/0 row sits below the
 * actually-busy worker rows.
 */
function roleOrder(role: WorkerRole): [number, number] {
  switch (role.kind) {
    case 'supervisor':
      return [0, 0]
    case 'worker':
      return [1, role.childId]
    case 'sequential':
      return [2, 0]
    case 'aggregator':
      return [3, 0]
    default:
      return [4, 0]
  }
}

export async function listWorkers(): Promise<MachineGroup[]> {
  const conn = getRedis()
  const names = new Set<string>()
  let cursor = '0'
  do {
    const [next, keys] = await conn.scan(cursor, 'MATCH', 'backtest:worker:*', 'COUNT', 200)
    cursor = next
    for (const k of keys) {
      const base = k.replace(/:heartbeat$/, '')
      const name = base.substring('backtest:worker:'.length)
      if (name) names.add(name)
    }
  } while (cursor !== '0')

  const now = Date.now()
  const flat: WorkerProcess[] = []
  const toPrune: string[] = []
  for (const name of names) {
    const hash = await conn.hgetall(`backtest:worker:${name}`)
    const hbStr = await conn.get(`backtest:worker:${name}:heartbeat`)
    const hb = hbStr ? Number(hbStr) : null
    const heartbeatAgeMs = hb !== null && Number.isFinite(hb) ? Math.max(0, now - hb) : null

    if (heartbeatAgeMs === null) {
      const lastFinishedAt = hash.lastFinishedAt ? Number(hash.lastFinishedAt) : null
      const ageSinceLastWork =
        lastFinishedAt !== null && Number.isFinite(lastFinishedAt) ? now - lastFinishedAt : Infinity
      if (ageSinceLastWork > STALE_WORKER_GRACE_MS) {
        toPrune.push(name)
        continue
      }
    }

    const hashIdx = name.indexOf('#')
    if (hashIdx === -1) {
      // Legacy / malformed key without role suffix — keep it but mark unknown.
      flat.push({
        processKey: name,
        role: { kind: 'unknown', raw: name },
        commitSha: hash.commitSha ?? null,
        branchName: hash.branchName ?? null,
        mainCommitSha: hash.mainCommitSha ?? null,
        mainCommitMatch: hash.mainCommitMatch === '1',
        heartbeatAgeMs,
        alive: heartbeatAgeMs !== null && heartbeatAgeMs < 30_000,
        processedTotal: Number(hash.processedTotal ?? 0) || 0,
        eventsTotal: Number(hash.eventsTotal ?? 0) || 0,
        lastMarket: hash.lastMarket ?? null,
        lastFinishedAt: hash.lastFinishedAt ? Number(hash.lastFinishedAt) : null,
        queues: hash.queues ?? null,
      })
      continue
    }

    flat.push({
      processKey: name,
      role: parseRole(name.substring(hashIdx + 1)),
      commitSha: hash.commitSha ?? null,
      branchName: hash.branchName ?? null,
      mainCommitSha: hash.mainCommitSha ?? null,
      mainCommitMatch: hash.mainCommitMatch === '1',
      heartbeatAgeMs,
      alive: heartbeatAgeMs !== null && heartbeatAgeMs < 30_000,
      processedTotal: Number(hash.processedTotal ?? 0) || 0,
      eventsTotal: Number(hash.eventsTotal ?? 0) || 0,
      lastMarket: hash.lastMarket ?? null,
      lastFinishedAt: hash.lastFinishedAt ? Number(hash.lastFinishedAt) : null,
      queues: hash.queues ?? null,
    })
  }

  if (toPrune.length > 0) {
    const pipe = conn.pipeline()
    for (const name of toPrune) {
      pipe.del(`backtest:worker:${name}`)
      pipe.del(`backtest:worker:${name}:heartbeat`)
    }
    try {
      await pipe.exec()
    } catch {
      /* best-effort */
    }
  }

  // Group by machineId (everything before `#`; the legacy unknown rows use the
  // full key as their own machine bucket).
  const groups = new Map<string, WorkerProcess[]>()
  for (const p of flat) {
    const hashIdx = p.processKey.indexOf('#')
    const machineId = hashIdx === -1 ? p.processKey : p.processKey.substring(0, hashIdx)
    const arr = groups.get(machineId) ?? []
    arr.push(p)
    groups.set(machineId, arr)
  }

  const result: MachineGroup[] = []
  for (const [machineId, allProcesses] of groups) {
    // The supervisor heartbeat is kept in Redis (useful forensic signal —
    // proves a machine's parent process is reachable even if all workers
    // died) but it has nothing meaningful to render in the table: it owns
    // no queue work, so processed/events are always 0. The machine header
    // row already represents the supervisor visually.
    const supervisor = allProcesses.find((p) => p.role.kind === 'supervisor') ?? null
    const processes = allProcesses.filter((p) => p.role.kind !== 'supervisor')
    processes.sort((a, b) => {
      const oa = roleOrder(a.role)
      const ob = roleOrder(b.role)
      return oa[0] - ob[0] || oa[1] - ob[1]
    })
    // Machine totals exclude the supervisor/aggregator rows — their counters
    // are always 0 (they don't process markets themselves), so summing them
    // is a no-op but conceptually the totals describe "work done on this
    // machine" which is the workers' contribution.
    const workerProcs = processes.filter(
      (p) => p.role.kind === 'worker' || p.role.kind === 'sequential',
    )
    result.push({
      machineId,
      processes,
      supervisorQueues: supervisor?.queues ?? null,
      totals: {
        processedTotal: workerProcs.reduce((s, p) => s + p.processedTotal, 0),
        eventsTotal: workerProcs.reduce((s, p) => s + p.eventsTotal, 0),
        aliveCount: processes.filter((p) => p.alive).length,
      },
    })
  }

  // Most-active machine first.
  result.sort((a, b) => b.totals.eventsTotal - a.totals.eventsTotal)
  return result
}
