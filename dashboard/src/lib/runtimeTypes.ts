export type RuntimeRunStatus =
  | 'idle'
  | 'running'
  | 'pause_requested'
  | 'paused'
  | 'waiting'
  | 'rate_limited'
  | 'completed'
  | 'stopped'
  | 'error'

export type RuntimeRun = {
  id: number
  /** Owning machine (12-hex id); commands must reach this machine's daemon. */
  machineId: string
  name: string
  provider: 'claude' | 'codex'
  model: string
  effort: string
  accessMode: 'workspace-write' | 'full-access'
  authHome: string | null
  /** srt sandbox settings path on the owning machine; null = unsandboxed. */
  sandboxSettingsPath: string | null
  workspacePath: string
  missionPath: string
  maxSessions: number
  delaySeconds: number
  statusFile: string
  journalFile: string
  inboxFile: string
  readOnlyFiles: string[]
  status: RuntimeRunStatus
  currentSession: number
  processId: number | null
  heartbeatAt: string | null
  lastActivityAt: string | null
  nextStartAt: string | null
  startedAt: string | null
  endedAt: string | null
  lastError: string | null
  lastResultSummary: string | null
  createdAt: string
  updatedAt: string
}

export type RuntimeSession = {
  id: number
  sessionNumber: number
  provider: 'claude' | 'codex'
  model: string
  effort: string
  status: string
  processId: number | null
  action: 'continue' | 'complete' | 'wait' | null
  summary: string | null
  error: string | null
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  cacheReadInputTokens: number | null
  cacheCreationInputTokens: number | null
  estimatedApiCostUsd: number | null
  resolvedModel: string | null
  prompt: string | null
  contractVersion: number | null
  missionHash: string | null
  rawLogPath: string
  startedAt: string
  finishedAt: string | null
}

export type RuntimeRunDetail = {
  run: RuntimeRun
  sessions: RuntimeSession[]
  totals: {
    inputTokens: number | null
    cachedInputTokens: number | null
    cacheReadInputTokens: number | null
    cacheCreationInputTokens: number | null
    outputTokens: number | null
    reasoningOutputTokens: number | null
    estimatedApiCostUsd: number | null
  }
}

export type RuntimeRunSummary = RuntimeRun & {
  resolvedModel: string | null
  totals: RuntimeRunDetail['totals']
}

export type MachineHealth = {
  machineId: string
  name: string
  online: boolean
  /** Daemon replied but is still initializing (503 from /health). */
  ready: boolean
  error: string | null
}

export type RuntimeFile = {
  role: 'mission' | 'status' | 'journal' | 'inbox' | 'read_only'
  path: string
  exists: boolean
  content: string
  truncated: boolean
  modifiedAt: string | null
}
