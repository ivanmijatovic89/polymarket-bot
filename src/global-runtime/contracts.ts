import { readFileSync } from 'node:fs'
import type { RuntimeRun } from './types.js'

export const GLOBAL_RUNTIME_CONTRACT_VERSION = 1
export const SESSION_RESULT_FILE = '.global-runtime/session-result.json'
export const RUNTIME_PROCESS_TOKEN_ENV = 'GLOBAL_RUNTIME_PROCESS_TOKEN'

// The contract prose lives in session-contract.md so it can be edited without
// touching code. Placeholders use {{name}} syntax; rendering fails loudly on a
// placeholder this function does not provide.
const SESSION_CONTRACT_TEMPLATE = readFileSync(
  new URL('./session-contract.md', import.meta.url),
  'utf8',
)

export function buildRuntimeProcessToken(runId: number, sessionNumber: number): string {
  return `run-${runId}-session-${sessionNumber}`
}

export const SESSION_RESULT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['continue', 'complete', 'wait'] },
    summary: { type: 'string', minLength: 1, maxLength: 4000 },
  },
  required: ['action', 'summary'],
  additionalProperties: false,
} as const

export function buildSessionPrompt(run: RuntimeRun, sessionNumber: number): string {
  const values: Record<string, string> = {
    sessionNumber: String(sessionNumber),
    maxSessions: String(run.maxSessions),
    name: run.name,
    missionPath: run.missionPath,
    statusFile: run.statusFile,
    journalFile: run.journalFile,
    inboxFile: run.inboxFile,
    resultFile: SESSION_RESULT_FILE,
    contractVersion: String(GLOBAL_RUNTIME_CONTRACT_VERSION),
    extraFiles:
      run.readOnlyFiles.length === 0
        ? 'None.'
        : run.readOnlyFiles.map((file) => `- ${file}`).join('\n'),
  }
  return SESSION_CONTRACT_TEMPLATE.replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) {
      throw new Error(`session-contract.md uses an unknown placeholder {{${key}}}`)
    }
    return value
  }).trimEnd()
}
