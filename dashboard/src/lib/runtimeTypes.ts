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
  name: string
  provider: 'claude' | 'codex'
  model: string
  effort: string
  accessMode: 'workspace-write' | 'full-access'
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
  startedAt: string
  finishedAt: string | null
}

export type RuntimeRunDetail = {
  run: RuntimeRun
  sessions: RuntimeSession[]
  totals: {
    inputTokens: number | null
    cachedInputTokens: number | null
    outputTokens: number | null
    reasoningOutputTokens: number | null
  }
}

export type RuntimeFile = {
  role: 'status' | 'journal' | 'inbox' | 'read_only'
  path: string
  exists: boolean
  content: string
  truncated: boolean
  modifiedAt: string | null
}
