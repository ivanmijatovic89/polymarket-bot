import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { runtimeRuns, runtimeSessions } from '../schema'

/**
 * DB-backed reads for Mission Control (issue #213). Runs may live on ANY
 * machine's Global Runtime daemon; the dashboard reads history straight from
 * the shared MySQL so lists and detail pages stay browsable while an owning
 * machine is offline. Commands still go to the owning daemon via
 * `runtimeProxy.ts`.
 *
 * The shapes mirror `GlobalRuntime.listRuns()` / `getRunDetail()` exactly
 * (session totals with SQL-SUM null semantics — all-null column ⇒ null, not
 * 0 — and `resolvedModel` picked from the LATEST session that has one, since
 * sessions are ordered by session_number DESC). Keep in sync with
 * `src/global-runtime/runtime.ts`.
 */

type RunRow = typeof runtimeRuns.$inferSelect
type SessionRow = typeof runtimeSessions.$inferSelect

/** Statuses whose `updatedAt` moves on its own (heartbeats). */
const LIVE_STATUSES = new Set(['running', 'pause_requested', 'rate_limited'])

/**
 * List order: active runs first, then newest activity. Keep in sync with
 * `src/global-runtime/dbStore.ts` / `memoryStore.ts`.
 */
export function compareRunsForList(
  a: { id: number; status: string; updatedAt: Date },
  b: { id: number; status: string; updatedAt: Date },
): number {
  const aLive = LIVE_STATUSES.has(a.status)
  const bLive = LIVE_STATUSES.has(b.status)
  if (aLive !== bLive) return aLive ? -1 : 1
  // Live rows: id only — their updatedAt ticks every heartbeat and would make
  // the table reshuffle between polls.
  if (aLive) return b.id - a.id
  const byUpdated = b.updatedAt.getTime() - a.updatedAt.getTime()
  return byUpdated !== 0 ? byUpdated : b.id - a.id
}

export type RuntimeUsageTotals = {
  inputTokens: number | null
  cachedInputTokens: number | null
  cacheReadInputTokens: number | null
  cacheCreationInputTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  estimatedApiCostUsd: number | null
}

const USAGE_KEYS = [
  'inputTokens',
  'cachedInputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'estimatedApiCostUsd',
] as const

type UsageCarrier = Pick<SessionRow, (typeof USAGE_KEYS)[number]>

/**
 * SQL-SUM null semantics per column: null when NO session has a value,
 * otherwise the sum of the non-null values.
 */
export function totalUsage(sessions: UsageCarrier[]): RuntimeUsageTotals {
  const totals = {} as Record<(typeof USAGE_KEYS)[number], number | null>
  for (const key of USAGE_KEYS) {
    const values = sessions
      .map((session) => session[key])
      .filter((value): value is number => value !== null)
    totals[key] = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)
  }
  return totals
}

/** Latest session's non-null resolved model (sessions must be ordered newest-first). */
export function pickResolvedModel(sessions: Pick<SessionRow, 'resolvedModel'>[]): string | null {
  return sessions.find((session) => session.resolvedModel)?.resolvedModel ?? null
}

export function mapRunRow(row: RunRow) {
  return {
    id: row.id,
    machineId: row.machineId,
    name: row.name,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    accessMode: row.accessMode,
    authHome: row.authHome,
    sandboxSettingsPath: row.sandboxSettingsPath,
    workspacePath: row.workspacePath,
    missionPath: row.missionPath,
    maxSessions: row.maxSessions,
    delaySeconds: row.delaySeconds,
    statusFile: row.statusFile,
    journalFile: row.journalFile,
    inboxFile: row.inboxFile,
    readOnlyFiles: row.readOnlyFiles,
    status: row.status,
    currentSession: row.currentSession,
    processId: row.processId,
    heartbeatAt: row.heartbeatAt,
    lastActivityAt: row.lastActivityAt,
    nextStartAt: row.nextStartAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lastError: row.lastError,
    lastResultSummary: row.lastResultSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function mapSessionRow(row: SessionRow) {
  return {
    id: row.id,
    sessionNumber: row.sessionNumber,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    status: row.status,
    processId: row.processId,
    action: row.action,
    summary: row.summary,
    error: row.error,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    reasoningOutputTokens: row.reasoningOutputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    estimatedApiCostUsd: row.estimatedApiCostUsd,
    resolvedModel: row.resolvedModel,
    prompt: row.prompt,
    contractVersion: row.contractVersion,
    missionHash: row.missionHash,
    rawLogPath: row.rawLogPath,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }
}

export type RuntimeRunSummaryRecord = ReturnType<typeof mapRunRow> & {
  resolvedModel: string | null
  totals: RuntimeUsageTotals
}

export type RuntimeRunDetailRecord = {
  run: ReturnType<typeof mapRunRow>
  sessions: ReturnType<typeof mapSessionRow>[]
  totals: RuntimeUsageTotals
}

/**
 * All runs across all machines, active first then newest activity — mirrors
 * GlobalRuntime.listRuns(). Active rows are NOT ordered by updatedAt among
 * themselves: a running loop bumps updatedAt on every heartbeat, so that made
 * them swap places on each 5s poll. Within the active group the order is by id
 * (stable while running); idle rows keep updatedAt order, which no longer moves.
 */
export async function listRuntimeRunSummaries(): Promise<RuntimeRunSummaryRecord[]> {
  const db = getDb()
  const runs = (await db.select().from(runtimeRuns)).sort(compareRunsForList)
  const sessions = await db
    .select({
      runId: runtimeSessions.runId,
      sessionNumber: runtimeSessions.sessionNumber,
      resolvedModel: runtimeSessions.resolvedModel,
      inputTokens: runtimeSessions.inputTokens,
      cachedInputTokens: runtimeSessions.cachedInputTokens,
      cacheReadInputTokens: runtimeSessions.cacheReadInputTokens,
      cacheCreationInputTokens: runtimeSessions.cacheCreationInputTokens,
      outputTokens: runtimeSessions.outputTokens,
      reasoningOutputTokens: runtimeSessions.reasoningOutputTokens,
      estimatedApiCostUsd: runtimeSessions.estimatedApiCostUsd,
    })
    .from(runtimeSessions)
    .orderBy(desc(runtimeSessions.sessionNumber))
  const byRun = new Map<number, typeof sessions>()
  for (const session of sessions) {
    const bucket = byRun.get(session.runId)
    if (bucket) bucket.push(session)
    else byRun.set(session.runId, [session])
  }
  return runs.map((row) => {
    const runSessions = byRun.get(row.id) ?? []
    return {
      ...mapRunRow(row),
      resolvedModel: pickResolvedModel(runSessions),
      totals: totalUsage(runSessions),
    }
  })
}

/** One run + its sessions (newest first) from the DB, or null when unknown. */
export async function getRuntimeRunDetail(id: number): Promise<RuntimeRunDetailRecord | null> {
  const db = getDb()
  const [row] = await db.select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).limit(1)
  if (!row) return null
  const sessionRows = await db
    .select()
    .from(runtimeSessions)
    .where(eq(runtimeSessions.runId, id))
    .orderBy(desc(runtimeSessions.sessionNumber))
  return {
    run: mapRunRow(row),
    sessions: sessionRows.map(mapSessionRow),
    totals: totalUsage(sessionRows),
  }
}

// Run → owning machine. Ownership is immutable (stamped at createRun and
// never patched), so a positive lookup can be cached for the process
// lifetime; misses are NOT cached (the run may simply not exist yet).
const machineIdCache = new Map<number, string>()

export async function getRunMachineId(id: number): Promise<string | null> {
  const cached = machineIdCache.get(id)
  if (cached) return cached
  const [row] = await getDb()
    .select({ machineId: runtimeRuns.machineId })
    .from(runtimeRuns)
    .where(eq(runtimeRuns.id, id))
    .limit(1)
  if (!row) return null
  machineIdCache.set(id, row.machineId)
  return row.machineId
}
