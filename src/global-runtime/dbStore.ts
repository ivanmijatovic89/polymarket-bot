import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { getDb, runtimeRuns, runtimeSessions } from '../db/index.js'
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

const ACTIVE_RUN_STATUSES: RuntimeRun['status'][] = ['running', 'pause_requested', 'rate_limited']

export class DrizzleRuntimeStore implements RuntimeStore {
  async createRun(input: CreateRuntimeRunInput): Promise<RuntimeRun> {
    const db = getDb()
    const ids = await db.insert(runtimeRuns).values(input).$returningId()
    const id = ids[0]?.id
    if (id === undefined) throw new Error('runtime run insert did not return an id')
    return this.requireRun(id)
  }

  async getRun(id: number): Promise<RuntimeRun | null> {
    const rows = await getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).limit(1)
    return rows[0] ? mapRun(rows[0]) : null
  }

  async listRuns(): Promise<RuntimeRun[]> {
    const rows = await getDb().select().from(runtimeRuns).orderBy(desc(runtimeRuns.updatedAt))
    return rows.map(mapRun)
  }

  async updateRun(id: number, patch: RuntimeRunPatch): Promise<RuntimeRun> {
    await getDb()
      .update(runtimeRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(runtimeRuns.id, id))
    return this.requireRun(id)
  }

  async listRunsByStatuses(statuses: RuntimeRun['status'][]): Promise<RuntimeRun[]> {
    if (statuses.length === 0) return []
    const rows = await getDb()
      .select()
      .from(runtimeRuns)
      .where(inArray(runtimeRuns.status, statuses))
    return rows.map(mapRun)
  }

  async findWorkspaceConflict(
    workspacePath: string,
    excludeRunId?: number,
  ): Promise<RuntimeRun | null> {
    const workspace = eq(runtimeRuns.workspacePath, workspacePath)
    const active = inArray(runtimeRuns.status, ACTIVE_RUN_STATUSES)
    const where =
      excludeRunId === undefined
        ? and(workspace, active)
        : and(workspace, active, ne(runtimeRuns.id, excludeRunId))
    const rows = await getDb().select().from(runtimeRuns).where(where).limit(1)
    return rows[0] ? mapRun(rows[0]) : null
  }

  async createSession(input: CreateSessionInput): Promise<RuntimeSession> {
    const ids = await getDb().insert(runtimeSessions).values(input).$returningId()
    const id = ids[0]?.id
    if (id === undefined) throw new Error('runtime session insert did not return an id')
    return this.requireSession(id)
  }

  async startSession(
    input: CreateSessionInput,
    runPatch: RuntimeRunPatch,
  ): Promise<RuntimeSession> {
    const db = getDb()
    const id = await db.transaction(async (tx) => {
      const ids = await tx.insert(runtimeSessions).values(input).$returningId()
      const insertedId = ids[0]?.id
      if (insertedId === undefined) throw new Error('runtime session insert did not return an id')
      await tx
        .update(runtimeRuns)
        .set({ ...runPatch, updatedAt: new Date() })
        .where(eq(runtimeRuns.id, input.runId))
      return insertedId
    })
    return this.requireSession(id)
  }

  async getSession(id: number): Promise<RuntimeSession | null> {
    const rows = await getDb()
      .select()
      .from(runtimeSessions)
      .where(eq(runtimeSessions.id, id))
      .limit(1)
    return rows[0] ? mapSession(rows[0]) : null
  }

  async listSessions(runId: number): Promise<RuntimeSession[]> {
    const rows = await getDb()
      .select()
      .from(runtimeSessions)
      .where(eq(runtimeSessions.runId, runId))
      .orderBy(desc(runtimeSessions.sessionNumber))
    return rows.map(mapSession)
  }

  async updateSession(id: number, patch: RuntimeSessionPatch): Promise<RuntimeSession> {
    await getDb().update(runtimeSessions).set(patch).where(eq(runtimeSessions.id, id))
    return this.requireSession(id)
  }

  async finishRunningSessions(
    runId: number,
    status: RuntimeSessionStatus,
    error: string,
  ): Promise<void> {
    await getDb()
      .update(runtimeSessions)
      .set({ status, error, finishedAt: new Date() })
      .where(and(eq(runtimeSessions.runId, runId), eq(runtimeSessions.status, 'running')))
  }

  private async requireRun(id: number): Promise<RuntimeRun> {
    const run = await this.getRun(id)
    if (!run) throw new RuntimeNotFoundError(`runtime run ${id} was not found`)
    return run
  }

  private async requireSession(id: number): Promise<RuntimeSession> {
    const session = await this.getSession(id)
    if (!session) throw new RuntimeNotFoundError(`runtime session ${id} was not found`)
    return session
  }
}

function mapRun(row: typeof runtimeRuns.$inferSelect): RuntimeRun {
  return {
    ...row,
    readOnlyFiles: row.readOnlyFiles ?? [],
  }
}

function mapSession(row: typeof runtimeSessions.$inferSelect): RuntimeSession {
  return row
}
