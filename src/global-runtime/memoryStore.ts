import { RuntimeNotFoundError } from './errors.js'
import type { CreateSessionInput, RuntimeStore } from './store.js'
import type {
  CreateRuntimeRunInput,
  RuntimeRun,
  RuntimeRunPatch,
  RuntimeSession,
  RuntimeSessionPatch,
  RuntimeSessionStatus,
} from './types.js'

export class MemoryRuntimeStore implements RuntimeStore {
  private readonly runs = new Map<number, RuntimeRun>()
  private readonly sessions = new Map<number, RuntimeSession>()
  private nextRunId = 1
  private nextSessionId = 1
  private runtimeLeaseHeld = false

  async acquireRuntimeLease(
    onLost: (error: unknown) => void,
  ): Promise<(() => Promise<void>) | null> {
    void onLost
    if (this.runtimeLeaseHeld) return null
    this.runtimeLeaseHeld = true
    let released = false
    return () => {
      if (!released) {
        released = true
        this.runtimeLeaseHeld = false
      }
      return Promise.resolve()
    }
  }

  async createRun(input: CreateRuntimeRunInput): Promise<RuntimeRun> {
    const now = new Date()
    const run: RuntimeRun = {
      ...input,
      readOnlyFiles: [...input.readOnlyFiles],
      id: this.nextRunId++,
      status: 'idle',
      currentSession: 0,
      processId: null,
      heartbeatAt: null,
      lastActivityAt: null,
      nextStartAt: null,
      startedAt: null,
      endedAt: null,
      lastError: null,
      lastResultSummary: null,
      createdAt: now,
      updatedAt: now,
    }
    this.runs.set(run.id, run)
    return cloneRun(run)
  }

  async getRun(id: number): Promise<RuntimeRun | null> {
    const run = this.runs.get(id)
    return run ? cloneRun(run) : null
  }

  async listRuns(): Promise<RuntimeRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(cloneRun)
  }

  async updateRun(id: number, patch: RuntimeRunPatch): Promise<RuntimeRun> {
    const run = this.runs.get(id)
    if (!run) throw new RuntimeNotFoundError(`runtime run ${id} was not found`)
    const updated = { ...run, ...patch, updatedAt: new Date() }
    this.runs.set(id, updated)
    return cloneRun(updated)
  }

  async listRunsByStatuses(statuses: RuntimeRun['status'][]): Promise<RuntimeRun[]> {
    const wanted = new Set(statuses)
    return [...this.runs.values()].filter((run) => wanted.has(run.status)).map(cloneRun)
  }

  async createSession(input: CreateSessionInput): Promise<RuntimeSession> {
    const session = this.buildSession(input)
    this.sessions.set(session.id, session)
    return cloneSession(session)
  }

  async startSession(
    input: CreateSessionInput,
    runPatch: RuntimeRunPatch,
  ): Promise<RuntimeSession> {
    const run = this.runs.get(input.runId)
    if (!run) throw new RuntimeNotFoundError(`runtime run ${input.runId} was not found`)
    const session = this.buildSession(input)
    const updatedRun = { ...run, ...runPatch, updatedAt: new Date() }
    this.sessions.set(session.id, session)
    this.runs.set(run.id, updatedRun)
    return cloneSession(session)
  }

  async getSession(id: number): Promise<RuntimeSession | null> {
    const session = this.sessions.get(id)
    return session ? cloneSession(session) : null
  }

  async listSessions(runId: number): Promise<RuntimeSession[]> {
    return [...this.sessions.values()]
      .filter((session) => session.runId === runId)
      .sort((a, b) => b.sessionNumber - a.sessionNumber)
      .map(cloneSession)
  }

  async updateSession(id: number, patch: RuntimeSessionPatch): Promise<RuntimeSession> {
    const session = this.sessions.get(id)
    if (!session) throw new RuntimeNotFoundError(`runtime session ${id} was not found`)
    const updated = { ...session, ...patch }
    this.sessions.set(id, updated)
    return cloneSession(updated)
  }

  async finishRunningSessions(
    runId: number,
    status: RuntimeSessionStatus,
    error: string,
  ): Promise<void> {
    const now = new Date()
    for (const [id, session] of this.sessions) {
      if (session.runId === runId && session.status === 'running') {
        this.sessions.set(id, { ...session, status, error, finishedAt: now })
      }
    }
  }

  private buildSession(input: CreateSessionInput): RuntimeSession {
    return {
      ...input,
      id: this.nextSessionId++,
      status: 'running',
      processId: null,
      action: null,
      summary: null,
      error: null,
      exitCode: null,
      exitSignal: null,
      inputTokens: null,
      cachedInputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      estimatedApiCostUsd: null,
      resolvedModel: null,
      heartbeatAt: input.startedAt,
      lastActivityAt: null,
      finishedAt: null,
      createdAt: input.startedAt,
    }
  }
}

function cloneRun(run: RuntimeRun): RuntimeRun {
  return { ...run, readOnlyFiles: [...run.readOnlyFiles] }
}

function cloneSession(session: RuntimeSession): RuntimeSession {
  return { ...session }
}
