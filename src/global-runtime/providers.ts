import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { finished } from 'node:stream/promises'
import { SESSION_RESULT_JSON_SCHEMA } from './contracts.js'
import { estimateCodexApiCost, resolveCodexModel } from './pricing.js'
import type { RuntimeRun, TokenUsage } from './types.js'

export interface ProviderExecutionContext {
  run: RuntimeRun
  sessionNumber: number
  prompt: string
  logDirectory: string
}

export interface ProviderExecutionCallbacks {
  onStarted(pid: number): void | Promise<void>
  onActivity(at: Date): void | Promise<void>
}

export interface ProviderExecutionResult {
  exitCode: number | null
  exitSignal: string | null
  finalResult: unknown
  usage: TokenUsage
  resolvedModel: string | null
  rateLimited: boolean
  error: string | null
  rawLogPath: string
}

export interface ProviderAdapter {
  execute(
    context: ProviderExecutionContext,
    signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult>
}

export interface PreparedCommand {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  rawLogPath: string
  stderrLogPath: string
  finalOutputPath: string | null
}

interface ParsedProviderOutput {
  finalResult: unknown
  usage: TokenUsage
  resolvedModel: string | null
  errors: string[]
}

const EMPTY_USAGE: TokenUsage = {
  inputTokens: null,
  cachedInputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  outputTokens: null,
  reasoningOutputTokens: null,
  estimatedApiCostUsd: null,
}

export class CliProviderAdapter implements ProviderAdapter {
  async execute(
    context: ProviderExecutionContext,
    signal: AbortSignal,
    callbacks: ProviderExecutionCallbacks,
  ): Promise<ProviderExecutionResult> {
    const prepared = await prepareProviderCommand(context)
    const rawLog = createWriteStream(prepared.rawLogPath, { flags: 'a', mode: 0o600 })
    const stderrLog = createWriteStream(prepared.stderrLogPath, { flags: 'a', mode: 0o600 })
    const streamErrors: string[] = []
    let child: ChildProcess | null = null
    const observeStream = (stream: typeof rawLog, label: string): Promise<void> => {
      stream.on('error', (error) => {
        if (streamErrors.length === 0 && child) terminateChild(child)
        streamErrors.push(`${label}: ${error.message}`)
      })
      return finished(stream).catch(() => undefined)
    }
    const rawLogFinished = observeStream(rawLog, 'raw log failed')
    const stderrLogFinished = observeStream(stderrLog, 'stderr log failed')
    const events: unknown[] = []
    let stderrText = ''
    let spawnError: string | null = null

    child = spawn(prepared.command, prepared.args, {
      cwd: prepared.cwd,
      env: prepared.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    if (streamErrors.length > 0) terminateChild(child)

    const stdoutLines = createInterface({ input: child.stdout! })
    stdoutLines.on('line', (line) => {
      rawLog.write(`${line}\n`)
      void Promise.resolve(callbacks.onActivity(new Date())).catch(() => undefined)
      try {
        const event: unknown = JSON.parse(line)
        if (isRelevantEvent(context.run.provider, event)) {
          events.push(event)
          if (events.length > 100) events.shift()
        }
      } catch {
        // The complete line remains in the raw log; only structured summary events stay in memory.
      }
    })

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderrLog.write(text)
      stderrText = `${stderrText}${text}`.slice(-65_536)
      void Promise.resolve(callbacks.onActivity(new Date())).catch(() => undefined)
    })

    const completion = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      let settled = false
      const finish = (value: { code: number | null; signal: string | null }) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      child.once('error', (error) => {
        spawnError = error.message
      })
      child.once('close', (code, exitSignal) => finish({ code, signal: exitSignal }))
    })

    const onAbort = () => terminateChild(child)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    let startCallbackError: unknown = null
    try {
      if (child.pid !== undefined) await callbacks.onStarted(child.pid)
    } catch (error) {
      startCallbackError = error
      terminateChild(child)
    }

    const exit = await completion

    signal.removeEventListener('abort', onAbort)
    stdoutLines.close()
    rawLog.end()
    stderrLog.end()
    await Promise.all([rawLogFinished, stderrLogFinished])

    if (startCallbackError) throw startCallbackError

    const parsed =
      context.run.provider === 'claude'
        ? parseClaudeEvents(events)
        : await parseCodexEvents(events, prepared.finalOutputPath, context.run.model)
    const providerErrors = [...parsed.errors, stderrText].filter(Boolean).join('\n')
    const combinedErrors = [spawnError, ...streamErrors, providerErrors].filter(Boolean).join('\n')

    return {
      exitCode: exit.code,
      exitSignal: exit.signal,
      finalResult: parsed.finalResult,
      usage: parsed.usage,
      resolvedModel: parsed.resolvedModel,
      rateLimited: isRateLimitError(providerErrors),
      error:
        spawnError ??
        streamErrors[0] ??
        (exit.code !== 0 && !signal.aborted
          ? combinedErrors.trim().slice(-4000) || `CLI exited with code ${String(exit.code)}`
          : null),
      rawLogPath: prepared.rawLogPath,
    }
  }
}

export async function prepareProviderCommand(
  context: ProviderExecutionContext,
): Promise<PreparedCommand> {
  await mkdir(context.logDirectory, { recursive: true })
  const baseName = `session-${String(context.sessionNumber).padStart(4, '0')}`
  const rawLogPath = path.join(context.logDirectory, `${baseName}.jsonl`)
  const stderrLogPath = path.join(context.logDirectory, `${baseName}.stderr.log`)
  const schemaPath = path.join(context.logDirectory, `${baseName}.schema.json`)
  await writeFile(schemaPath, JSON.stringify(SESSION_RESULT_JSON_SCHEMA, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })

  return context.run.provider === 'claude'
    ? prepareClaudeCommand(context, rawLogPath, stderrLogPath)
    : prepareCodexCommand(context, rawLogPath, stderrLogPath, schemaPath)
}

function prepareClaudeCommand(
  context: ProviderExecutionContext,
  rawLogPath: string,
  stderrLogPath: string,
): PreparedCommand {
  const permissionMode =
    context.run.accessMode === 'full-access' ? 'bypassPermissions' : 'acceptEdits'
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  }
  if (context.run.authHome) env.CLAUDE_CONFIG_DIR = expandHome(context.run.authHome)
  else delete env.CLAUDE_CONFIG_DIR

  return {
    command: process.env.GLOBAL_RUNTIME_CLAUDE_BIN?.trim() || 'claude',
    args: [
      '-p',
      '--model',
      context.run.model,
      '--effort',
      context.run.effort,
      '--permission-mode',
      permissionMode,
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--json-schema',
      JSON.stringify(SESSION_RESULT_JSON_SCHEMA),
      context.prompt,
    ],
    cwd: context.run.workspacePath,
    env,
    rawLogPath,
    stderrLogPath,
    finalOutputPath: null,
  }
}

function prepareCodexCommand(
  context: ProviderExecutionContext,
  rawLogPath: string,
  stderrLogPath: string,
  schemaPath: string,
): PreparedCommand {
  const finalOutputPath = path.join(
    context.logDirectory,
    `session-${String(context.sessionNumber).padStart(4, '0')}.result.json`,
  )
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (context.run.authHome) env.CODEX_HOME = expandHome(context.run.authHome)

  return {
    command: process.env.GLOBAL_RUNTIME_CODEX_BIN?.trim() || 'codex',
    args: [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--model',
      context.run.model,
      '--sandbox',
      context.run.accessMode === 'full-access' ? 'danger-full-access' : 'workspace-write',
      '-C',
      context.run.workspacePath,
      '--output-schema',
      schemaPath,
      '--output-last-message',
      finalOutputPath,
      '-c',
      `model_reasoning_effort="${context.run.effort}"`,
      '-c',
      'approval_policy="never"',
      context.prompt,
    ],
    cwd: context.run.workspacePath,
    env,
    rawLogPath,
    stderrLogPath,
    finalOutputPath,
  }
}

function parseClaudeEvents(events: unknown[]): ParsedProviderOutput {
  let resultEvent: Record<string, unknown> | null = null
  const errors: string[] = []
  for (const event of events) {
    if (!isRecord(event)) continue
    if (event.type === 'result') resultEvent = event
    if (event.type === 'error') errors.push(JSON.stringify(event))
  }
  if (!resultEvent) return { finalResult: null, usage: EMPTY_USAGE, resolvedModel: null, errors }

  const usage = isRecord(resultEvent.usage) ? resultEvent.usage : {}
  if (resultEvent.is_error === true && typeof resultEvent.result === 'string') {
    errors.push(resultEvent.result)
  }
  const finalResult =
    resultEvent.structured_output ??
    parseMaybeJson(resultEvent.result) ??
    resultEvent.result ??
    null
  return {
    finalResult,
    usage: {
      inputTokens: numberOrNull(usage.input_tokens),
      cachedInputTokens: sumNumbers(
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
      ),
      cacheReadInputTokens: numberOrNull(usage.cache_read_input_tokens),
      cacheCreationInputTokens: numberOrNull(usage.cache_creation_input_tokens),
      outputTokens: numberOrNull(usage.output_tokens),
      reasoningOutputTokens: null,
      estimatedApiCostUsd: numberOrNull(resultEvent.total_cost_usd),
    },
    resolvedModel: primaryClaudeModel(resultEvent.modelUsage),
    errors,
  }
}

async function parseCodexEvents(
  events: unknown[],
  finalOutputPath: string | null,
  requestedModel: string,
): Promise<ParsedProviderOutput> {
  let usage: TokenUsage = EMPTY_USAGE
  let fallbackFinal: unknown = null
  const errors: string[] = []
  for (const event of events) {
    if (!isRecord(event)) continue
    if (event.type === 'turn.completed' && isRecord(event.usage)) {
      const totalInputTokens = numberOrNull(event.usage.input_tokens)
      const cacheReadInputTokens = numberOrNull(event.usage.cached_input_tokens)
      const cacheCreationInputTokens = numberOrNull(
        event.usage.cache_write_tokens ?? event.usage.cache_creation_input_tokens,
      )
      usage = {
        inputTokens: subtractTokenParts(
          totalInputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
        ),
        cachedInputTokens: sumNumbers(cacheReadInputTokens, cacheCreationInputTokens),
        cacheReadInputTokens,
        cacheCreationInputTokens,
        outputTokens: numberOrNull(event.usage.output_tokens),
        reasoningOutputTokens: numberOrNull(event.usage.reasoning_output_tokens),
        estimatedApiCostUsd: null,
      }
      usage.estimatedApiCostUsd = estimateCodexApiCost(requestedModel, usage)
    }
    if (event.type === 'item.completed' && isRecord(event.item)) {
      if (event.item.type === 'agent_message') fallbackFinal = parseMaybeJson(event.item.text)
    }
    if (event.type === 'error' || event.type === 'turn.failed') errors.push(JSON.stringify(event))
  }

  let finalResult = fallbackFinal
  if (finalOutputPath) {
    try {
      finalResult = parseMaybeJson(await readFile(finalOutputPath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(String(error))
    }
  }
  return { finalResult, usage, resolvedModel: resolveCodexModel(requestedModel), errors }
}

function primaryClaudeModel(value: unknown): string | null {
  if (!isRecord(value)) return null
  let primary: { model: string; cost: number } | null = null
  for (const [model, rawUsage] of Object.entries(value)) {
    if (!isRecord(rawUsage)) continue
    const cost = numberOrNull(rawUsage.costUSD) ?? 0
    if (!primary || cost > primary.cost) primary = { model, cost }
  }
  return primary?.model ?? null
}

function subtractTokenParts(
  total: number | null,
  cacheRead: number | null,
  cacheCreation: number | null,
): number | null {
  if (total === null) return null
  return Math.max(0, total - (cacheRead ?? 0) - (cacheCreation ?? 0))
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRelevantEvent(provider: RuntimeRun['provider'], value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (provider === 'claude') return value.type === 'result' || value.type === 'error'
  if (value.type === 'turn.completed' || value.type === 'turn.failed' || value.type === 'error') {
    return true
  }
  return (
    value.type === 'item.completed' && isRecord(value.item) && value.item.type === 'agent_message'
  )
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sumNumbers(...values: unknown[]): number | null {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0)
}

function isRateLimitError(text: string): boolean {
  return /rate[ -]?limit|usage limit|quota|capacity resets|hit your limit/iu.test(text)
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value
}

function terminateChild(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }

  const killTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
    try {
      if (process.platform === 'win32') child.kill('SIGKILL')
      else process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, 5000)
  killTimer.unref()
}
