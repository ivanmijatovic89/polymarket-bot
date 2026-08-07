import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const runtimeProviders = ['claude', 'codex'] as const
// 'ultra' is Codex-only; 'ultracode' is Claude-only (xhigh + workflow
// orchestration — a valid `claude --effort` value even though the CLI help
// text lags behind it; verified empirically on Claude Code 2.1.220).
export const runtimeEfforts = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode',
  'ultra',
] as const
export const runtimeAccessModes = ['workspace-write', 'full-access'] as const
export const runtimeRunStatuses = [
  'idle',
  'running',
  'pause_requested',
  'paused',
  'waiting',
  'rate_limited',
  'completed',
  'stopped',
  'error',
] as const
export const runtimeSessionStatuses = [
  'running',
  'completed',
  'waiting',
  'rate_limited',
  'stopped',
  'failed',
  'invalid_result',
] as const
export const runtimeActions = ['continue', 'complete', 'wait'] as const

export type RuntimeProvider = (typeof runtimeProviders)[number]
export type RuntimeEffort = (typeof runtimeEfforts)[number]
export type RuntimeAccessMode = (typeof runtimeAccessModes)[number]
export type RuntimeRunStatus = (typeof runtimeRunStatuses)[number]
export type RuntimeSessionStatus = (typeof runtimeSessionStatuses)[number]
export type RuntimeAction = (typeof runtimeActions)[number]

const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => !value.startsWith('/') && !value.includes('\0'), 'must be a relative path')
  .refine(
    (value) => !value.split(/[\\/]+/u).includes('..'),
    'must stay inside the configured workspace',
  )

export const createRuntimeRunSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    provider: z.enum(runtimeProviders),
    model: z.string().trim().min(1).max(255),
    effort: z.enum(runtimeEfforts).default('high'),
    accessMode: z.enum(runtimeAccessModes).default('workspace-write'),
    authHome: z.string().trim().min(1).max(1024).nullable().default(null),
    /**
     * Absolute path (on the owning machine) to an srt sandbox settings file.
     * Non-null ⇒ sessions launch wrapped in `srt --settings <path>` with
     * DB/Redis routed through the daemon's localhost tunnels. File existence
     * is validated at createRun (machine-local I/O — not a zod concern).
     */
    sandboxSettingsPath: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine((value) => value.startsWith('/') && !value.includes('\0'), 'must be an absolute path')
      .nullable()
      .default(null),
    workspacePath: z.string().trim().min(1).max(1024),
    missionPath: relativePathSchema,
    maxSessions: z.coerce.number().int().min(1).max(10_000),
    delaySeconds: z.coerce.number().int().min(0).max(86_400).default(20),
    statusFile: relativePathSchema.optional(),
    journalFile: relativePathSchema.optional(),
    inboxFile: relativePathSchema.optional(),
    isolatedStateFiles: z.boolean().default(false),
    readOnlyFiles: z.array(relativePathSchema).max(20).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provider === 'claude' && value.effort === 'ultra') {
      ctx.addIssue({
        code: 'custom',
        path: ['effort'],
        message: 'Claude Code supports effort levels through max plus ultracode, not ultra',
      })
    }
    if (value.provider === 'codex' && value.effort === 'ultracode') {
      ctx.addIssue({
        code: 'custom',
        path: ['effort'],
        message: 'ultracode is a Claude Code effort level; Codex supports through ultra',
      })
    }
    if (
      value.isolatedStateFiles &&
      (value.statusFile !== undefined ||
        value.journalFile !== undefined ||
        value.inboxFile !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['isolatedStateFiles'],
        message: 'isolated state files cannot be combined with explicit state file paths',
      })
    }
  })
  .transform((value) => {
    const { isolatedStateFiles, ...run } = value
    const stateDirectory = isolatedStateFiles ? `.global-runtime/runs/${randomUUID()}` : null
    return {
      ...run,
      statusFile: run.statusFile ?? (stateDirectory ? `${stateDirectory}/STATUS.md` : 'STATUS.md'),
      journalFile:
        run.journalFile ?? (stateDirectory ? `${stateDirectory}/JOURNAL.md` : 'JOURNAL.md'),
      inboxFile: run.inboxFile ?? (stateDirectory ? `${stateDirectory}/INBOX.md` : 'INBOX.md'),
    }
  })

export type CreateRuntimeRunInput = z.infer<typeof createRuntimeRunSchema>

export const extendRunSchema = z
  .object({
    maxSessions: z.coerce.number().int().min(1).max(10_000),
  })
  .strict()

export const sessionResultSchema = z
  .object({
    action: z.enum(runtimeActions),
    summary: z.string().trim().min(1).max(4000),
  })
  .strict()

export type SessionResult = z.infer<typeof sessionResultSchema>

export const appendInboxSchema = z
  .object({
    message: z.string().trim().min(1).max(8000),
  })
  .strict()

export interface TokenUsage {
  inputTokens: number | null
  cachedInputTokens: number | null
  cacheReadInputTokens: number | null
  cacheCreationInputTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  estimatedApiCostUsd: number | null
}

export interface RuntimeRun extends CreateRuntimeRunInput {
  id: number
  /**
   * Owning machine (12-hex id from src/machines/identity.ts). Stamped by the
   * daemon at createRun — clients never send it (`.strict()` rejects it) —
   * and immutable for the run's lifetime.
   */
  machineId: string
  status: RuntimeRunStatus
  currentSession: number
  processId: number | null
  heartbeatAt: Date | null
  lastActivityAt: Date | null
  nextStartAt: Date | null
  startedAt: Date | null
  endedAt: Date | null
  lastError: string | null
  lastResultSummary: string | null
  createdAt: Date
  updatedAt: Date
}

export interface RuntimeSession extends TokenUsage {
  id: number
  runId: number
  sessionNumber: number
  provider: RuntimeProvider
  model: string
  effort: RuntimeEffort
  status: RuntimeSessionStatus
  processId: number | null
  action: RuntimeAction | null
  summary: string | null
  error: string | null
  exitCode: number | null
  exitSignal: string | null
  resolvedModel: string | null
  prompt: string | null
  contractVersion: number | null
  missionHash: string | null
  rawLogPath: string
  startedAt: Date
  heartbeatAt: Date | null
  lastActivityAt: Date | null
  finishedAt: Date | null
  createdAt: Date
}

export type RuntimeRunPatch = Partial<
  Pick<
    RuntimeRun,
    | 'status'
    | 'maxSessions'
    | 'currentSession'
    | 'processId'
    | 'heartbeatAt'
    | 'lastActivityAt'
    | 'nextStartAt'
    | 'startedAt'
    | 'endedAt'
    | 'lastError'
    | 'lastResultSummary'
  >
>

export type RuntimeSessionPatch = Partial<
  Pick<
    RuntimeSession,
    | 'status'
    | 'processId'
    | 'action'
    | 'summary'
    | 'error'
    | 'exitCode'
    | 'exitSignal'
    | 'inputTokens'
    | 'cachedInputTokens'
    | 'cacheReadInputTokens'
    | 'cacheCreationInputTokens'
    | 'outputTokens'
    | 'reasoningOutputTokens'
    | 'estimatedApiCostUsd'
    | 'resolvedModel'
    | 'heartbeatAt'
    | 'lastActivityAt'
    | 'finishedAt'
  >
>

export interface RuntimeRunDetail {
  run: RuntimeRun
  sessions: RuntimeSession[]
  totals: TokenUsage
}

export interface RuntimeRunSummary extends RuntimeRun {
  resolvedModel: string | null
  totals: TokenUsage
}

export interface RuntimeFileView {
  role: 'mission' | 'status' | 'journal' | 'inbox' | 'read_only'
  path: string
  exists: boolean
  content: string
  truncated: boolean
  modifiedAt: string | null
}

export interface RuntimeFilesResponse {
  files: RuntimeFileView[]
  /**
   * Contents of the workspace's OWNER file (protocol durability,
   * polymarket-bot#227): the fleet machine that owns this protocol folder.
   * Null when the workspace is not a protocol folder.
   */
  protocolOwner: string | null
}
