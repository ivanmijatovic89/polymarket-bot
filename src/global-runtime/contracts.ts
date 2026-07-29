import type { RuntimeRun } from './types.js'

export const GLOBAL_RUNTIME_CONTRACT_VERSION = 1
export const SESSION_RESULT_FILE = '.global-runtime/session-result.json'
export const RUNTIME_PROCESS_TOKEN_ENV = 'GLOBAL_RUNTIME_PROCESS_TOKEN'

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
  const extraFiles =
    run.readOnlyFiles.length === 0
      ? 'None.'
      : run.readOnlyFiles.map((file) => `- ${file}`).join('\n')

  return `You are session ${sessionNumber} of at most ${run.maxSessions} for the loop "${run.name}".

Follow Global Runtime Session Contract v${GLOBAL_RUNTIME_CONTRACT_VERSION}:

1. Read the mission at ${run.missionPath} and follow it.
2. Read ${run.statusFile} to recover the current state. If it does not exist, create it.
3. Read ${run.inboxFile}. Process entries newer than the "Inbox processed through" marker in ${run.statusFile}. Never edit the inbox.
4. Keep ${run.statusFile} concise and current: current work, completed work, next step, blockers, needs-human items, and the last processed inbox entry id.
5. Append short, human-readable milestone updates to ${run.journalFile} while you work. Do not paste raw tool output there.
6. Persist all mission memory in workspace files. Do not rely on conversation history; a fresh session must be able to continue from files.
7. Before finishing, update ${run.statusFile} and ${run.journalFile}.
8. Write ${SESSION_RESULT_FILE} with exactly one JSON object matching the required schema, then return the same object as your structured final result:
   - continue: useful work remains and the next fresh session should start.
   - complete: the mission is finished.
   - wait: human input or an external change is required.

Additional read-only files exposed in Mission Control:
${extraFiles}

Do not ask questions in conversational output. Put questions under "Needs human" in ${run.statusFile} and return action "wait".`
}
