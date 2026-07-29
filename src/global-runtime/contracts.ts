import { readFileSync } from 'node:fs'
import type { RuntimeRun } from './types.js'

export const SESSION_RESULT_FILE = '.global-runtime/session-result.json'
export const RUNTIME_PROCESS_TOKEN_ENV = 'GLOBAL_RUNTIME_PROCESS_TOKEN'

const SESSION_CONTRACT_PATH = new URL('./session-contract.md', import.meta.url)
const VERSION_MARKER = /^<!--\s*contract-version:\s*(\d+)\s*-->\s*/u

export interface SessionContract {
  version: number
  prompt: string
}

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

// The contract prose and its version both live in session-contract.md so the
// wording can be changed without touching code. The file is read per session
// rather than cached at import, so an edit applies to the next session of a
// running daemon. Placeholders use {{name}} syntax; rendering fails loudly on a
// placeholder this function does not provide.
export function renderSessionContract(run: RuntimeRun, sessionNumber: number): SessionContract {
  const { version, template } = readSessionContractTemplate()
  const values: Record<string, string> = {
    sessionNumber: String(sessionNumber),
    maxSessions: String(run.maxSessions),
    name: run.name,
    missionPath: run.missionPath,
    statusFile: run.statusFile,
    journalFile: run.journalFile,
    inboxFile: run.inboxFile,
    resultFile: SESSION_RESULT_FILE,
    contractVersion: String(version),
    extraFiles:
      run.readOnlyFiles.length === 0
        ? 'None.'
        : run.readOnlyFiles.map((file) => `- ${file}`).join('\n'),
  }
  const prompt = template
    .replace(/\{\{(\w+)\}\}/gu, (_match, key: string) => {
      const value = values[key]
      if (value === undefined) {
        throw new Error(`session-contract.md uses an unknown placeholder {{${key}}}`)
      }
      return value
    })
    .trimEnd()
  return { version, prompt }
}

function readSessionContractTemplate(): { version: number; template: string } {
  let raw: string
  try {
    raw = readFileSync(SESSION_CONTRACT_PATH, 'utf8')
  } catch (error) {
    throw new Error('session-contract.md could not be read', { cause: error })
  }
  const marker = VERSION_MARKER.exec(raw)
  if (!marker) {
    throw new Error('session-contract.md must start with a <!-- contract-version: N --> marker')
  }
  const version = Number(marker[1])
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`session-contract.md declares an invalid contract version "${marker[1]}"`)
  }
  return { version, template: raw.slice(marker[0].length) }
}
