import { z } from 'zod'

export const runtimeProviders = ['claude', 'codex'] as const
export const runtimeEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
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
    workspacePath: z.string().trim().min(1).max(1024),
    missionPath: relativePathSchema,
    maxSessions: z.coerce.number().int().min(1).max(10_000),
    delaySeconds: z.coerce.number().int().min(0).max(86_400).default(20),
    statusFile: relativePathSchema.default('STATUS.md'),
    journalFile: relativePathSchema.default('JOURNAL.md'),
    inboxFile: relativePathSchema.default('INBOX.md'),
    readOnlyFiles: z.array(relativePathSchema).max(20).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provider === 'claude' && value.effort === 'ultra') {
      ctx.addIssue({
        code: 'custom',
        path: ['effort'],
        message: 'Claude Code supports effort levels through max, not ultra',
      })
    }
  })

export type CreateRuntimeRunInput = z.infer<typeof createRuntimeRunSchema>

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
  role: 'status' | 'journal' | 'inbox' | 'read_only'
  path: string
  exists: boolean
  content: string
  truncated: boolean
  modifiedAt: string | null
}

export interface RuntimeFilesResponse {
  files: RuntimeFileView[]
}
