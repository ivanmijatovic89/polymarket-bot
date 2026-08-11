import type {
  CreateRuntimeRunInput,
  RuntimeRun,
  RuntimeRunPatch,
  RuntimeSession,
  RuntimeSessionPatch,
  RuntimeSessionStatus,
} from './types.js'

export interface CreateSessionInput {
  runId: number
  sessionNumber: number
  provider: RuntimeRun['provider']
  model: string
  effort: RuntimeRun['effort']
  prompt: string
  contractVersion: number
  missionHash: string | null
  rawLogPath: string
  startedAt: Date
}

/** Run insert record: the validated create input plus the daemon-stamped owner. */
export interface CreateRunRecord extends CreateRuntimeRunInput {
  machineId: string
}

/** Statuses whose `updatedAt` moves on its own (heartbeats). */
const LIVE_STATUSES = new Set<RuntimeRun['status']>(['running', 'pause_requested', 'rate_limited'])

/**
 * listRuns() order: active runs first, then newest activity. Live rows are
 * ordered by id, NOT updatedAt — a running loop bumps updatedAt on every
 * heartbeat, which made the dashboard table reshuffle between polls. Keep in
 * sync with `dashboard/src/lib/queries/runtimeRuns.ts`.
 */
export function compareRunsForList(
  a: Pick<RuntimeRun, 'id' | 'status' | 'updatedAt'>,
  b: Pick<RuntimeRun, 'id' | 'status' | 'updatedAt'>,
): number {
  const aLive = LIVE_STATUSES.has(a.status)
  const bLive = LIVE_STATUSES.has(b.status)
  if (aLive !== bLive) return aLive ? -1 : 1
  if (aLive) return b.id - a.id
  const byUpdated = b.updatedAt.getTime() - a.updatedAt.getTime()
  return byUpdated !== 0 ? byUpdated : b.id - a.id
}

export interface RuntimeStore {
  /**
   * Acquire the per-MACHINE runtime lease. machineId is a parameter (not
   * store state) so one store instance can serve multiple simulated machines
   * in tests; two daemons for the same machineId must exclude each other,
   * daemons for different machines must not.
   */
  acquireRuntimeLease(
    machineId: string,
    onLost: (error: unknown) => void,
  ): Promise<(() => Promise<void>) | null>

  createRun(input: CreateRunRecord): Promise<RuntimeRun>
  getRun(id: number): Promise<RuntimeRun | null>
  listRuns(): Promise<RuntimeRun[]>
  updateRun(id: number, patch: RuntimeRunPatch): Promise<RuntimeRun>
  /** When machineId is given, only that machine's runs are returned. */
  listRunsByStatuses(statuses: RuntimeRun['status'][], machineId?: string): Promise<RuntimeRun[]>

  createSession(input: CreateSessionInput): Promise<RuntimeSession>
  startSession(input: CreateSessionInput, runPatch: RuntimeRunPatch): Promise<RuntimeSession>
  getSession(id: number): Promise<RuntimeSession | null>
  listSessions(runId: number): Promise<RuntimeSession[]>
  updateSession(id: number, patch: RuntimeSessionPatch): Promise<RuntimeSession>
  finishRunningSessions(runId: number, status: RuntimeSessionStatus, error: string): Promise<void>
}
