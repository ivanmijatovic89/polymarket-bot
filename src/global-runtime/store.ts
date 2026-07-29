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
  rawLogPath: string
  startedAt: Date
}

export interface RuntimeStore {
  createRun(input: CreateRuntimeRunInput): Promise<RuntimeRun>
  getRun(id: number): Promise<RuntimeRun | null>
  listRuns(): Promise<RuntimeRun[]>
  updateRun(id: number, patch: RuntimeRunPatch): Promise<RuntimeRun>
  listRunsByStatuses(statuses: RuntimeRun['status'][]): Promise<RuntimeRun[]>
  findWorkspaceConflict(workspacePath: string, excludeRunId?: number): Promise<RuntimeRun | null>

  createSession(input: CreateSessionInput): Promise<RuntimeSession>
  startSession(input: CreateSessionInput, runPatch: RuntimeRunPatch): Promise<RuntimeSession>
  getSession(id: number): Promise<RuntimeSession | null>
  listSessions(runId: number): Promise<RuntimeSession[]>
  updateSession(id: number, patch: RuntimeSessionPatch): Promise<RuntimeSession>
  finishRunningSessions(runId: number, status: RuntimeSessionStatus, error: string): Promise<void>
}
