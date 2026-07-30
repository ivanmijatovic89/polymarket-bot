import '../config/env.js'
import path from 'node:path'
import { parseArgs } from 'node:util'

interface RunView {
  id: number
  name: string
  provider: string
  model: string
  effort: string
  accessMode: string
  authHome: string | null
  workspacePath: string
  missionPath: string
  maxSessions: number
  delaySeconds: number
  statusFile: string
  journalFile: string
  inboxFile: string
  readOnlyFiles: string[]
  status: string
  currentSession: number
  startedAt: string | null
  endedAt: string | null
  lastError: string | null
  lastResultSummary: string | null
}

interface SessionView {
  sessionNumber: number
  status: string
  action: string | null
  summary: string | null
  error: string | null
  resolvedModel: string | null
  rawLogPath: string
  startedAt: string
  finishedAt: string | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedApiCostUsd: number | null
}

interface DetailView {
  run: RunView
  sessions: SessionView[]
  totals: { estimatedApiCostUsd: number | null }
}

const BASE_URL = (process.env.GLOBAL_RUNTIME_URL?.trim() || 'http://127.0.0.1:3053').replace(
  /\/+$/u,
  '',
)

const USAGE = `Mission CLI — thin client for the Global Runtime daemon (${BASE_URL})

Usage:
  npm run mission -- create --name <name> --provider claude|codex --model <model> \\
      --workspace <path> --max-sessions <n> [--mission MISSION.md] \\
      [--effort low|medium|high|xhigh|max|ultra] [--access workspace-write|full-access] \\
      [--auth-home <dir>] [--delay <seconds>] [--isolated] [--read-only <path> ...] \\
      [--status-file <path>] [--journal-file <path>] [--inbox-file <path>] [--start]
  npm run mission -- list [--json]
  npm run mission -- show <id> [--json]
  npm run mission -- start|pause|resume|stop <id>
  npm run mission -- extend <id> --max-sessions <n>
  npm run mission -- inbox <id> <message>

The daemon must already be running (npm run global-runtime). This CLI only calls
its localhost API; it never manages provider processes itself.`

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'create':
      return create(rest)
    case 'list':
      return list(rest)
    case 'show':
      return show(rest)
    case 'start':
    case 'pause':
    case 'resume':
    case 'stop':
      return control(command, rest)
    case 'extend':
      return extend(rest)
    case 'inbox':
      return inbox(rest)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE)
      return
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`)
  }
}

async function create(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      access: { type: 'string' },
      'auth-home': { type: 'string' },
      workspace: { type: 'string' },
      mission: { type: 'string', default: 'MISSION.md' },
      'max-sessions': { type: 'string' },
      delay: { type: 'string' },
      'status-file': { type: 'string' },
      'journal-file': { type: 'string' },
      'inbox-file': { type: 'string' },
      isolated: { type: 'boolean', default: false },
      'read-only': { type: 'string', multiple: true },
      start: { type: 'boolean', default: false },
    },
  })
  for (const required of ['name', 'provider', 'model', 'workspace', 'max-sessions'] as const) {
    if (!values[required]) throw new Error(`--${required} is required\n\n${USAGE}`)
  }

  const { run } = await request<{ run: RunView }>('POST', '/runs', {
    name: values.name,
    provider: values.provider,
    model: values.model,
    ...(values.effort ? { effort: values.effort } : {}),
    ...(values.access ? { accessMode: values.access } : {}),
    authHome: values['auth-home'] ?? null,
    workspacePath: resolveFromInvocationDir(values.workspace!),
    missionPath: values.mission,
    maxSessions: Number(values['max-sessions']),
    ...(values.delay !== undefined ? { delaySeconds: Number(values.delay) } : {}),
    ...(values['status-file'] ? { statusFile: values['status-file'] } : {}),
    ...(values['journal-file'] ? { journalFile: values['journal-file'] } : {}),
    ...(values['inbox-file'] ? { inboxFile: values['inbox-file'] } : {}),
    ...(values.isolated ? { isolatedStateFiles: true } : {}),
    readOnlyFiles: values['read-only'] ?? [],
  })
  console.log(`Created loop ${run.id} (${run.status}): ${run.name}`)
  console.log(`  workspace: ${run.workspacePath}`)
  console.log(`  mission:   ${run.missionPath}`)
  console.log(`  state:     ${run.statusFile} · ${run.journalFile} · ${run.inboxFile}`)
  if (values.start) {
    const started = await request<{ run: RunView }>('POST', `/runs/${run.id}/start`)
    console.log(`Started loop ${run.id} (${started.run.status}).`)
  } else {
    console.log(`Start it with: npm run mission -- start ${run.id}`)
  }
}

async function list(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: 'boolean', default: false } },
  })
  const { runs } = await request<{ runs: RunView[] }>('GET', '/runs')
  if (values.json) {
    console.log(JSON.stringify(runs, null, 2))
    return
  }
  if (runs.length === 0) {
    console.log('No loops yet. Create one with: npm run mission -- create …')
    return
  }
  const header = ['id', 'status', 'provider', 'model', 'sessions', 'name']
  const rows = runs.map((run) => [
    String(run.id),
    run.status,
    run.provider,
    run.model,
    `${run.currentSession}/${run.maxSessions}`,
    run.name,
  ])
  printTable([header, ...rows])
}

async function show(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { json: { type: 'boolean', default: false } },
    allowPositionals: true,
  })
  const detail = await request<DetailView>('GET', `/runs/${requireId(positionals)}`)
  if (values.json) {
    console.log(JSON.stringify(detail, null, 2))
    return
  }
  const { run, sessions, totals } = detail
  console.log(`Loop ${run.id}: ${run.name}`)
  console.log(`  status:    ${run.status}${run.lastError ? ` — ${run.lastError}` : ''}`)
  console.log(`  provider:  ${run.provider} · ${run.model} · ${run.effort} · ${run.accessMode}`)
  console.log(`  sessions:  ${run.currentSession}/${run.maxSessions}`)
  console.log(`  workspace: ${run.workspacePath}`)
  console.log(`  mission:   ${run.missionPath}`)
  console.log(`  est. cost: ${formatUsd(totals.estimatedApiCostUsd)}`)
  if (run.lastResultSummary) console.log(`  last:      ${run.lastResultSummary}`)
  if (sessions.length > 0) {
    console.log('')
    const header = ['#', 'status', 'action', 'started', 'cost', 'summary']
    const rows = sessions.map((session) => [
      String(session.sessionNumber),
      session.status,
      session.action ?? '—',
      session.startedAt.replace('T', ' ').slice(0, 19),
      formatUsd(session.estimatedApiCostUsd),
      truncate(session.summary ?? session.error ?? '—', 60),
    ])
    printTable([header, ...rows])
  }
}

async function control(action: string, argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true })
  const id = requireId(positionals)
  const { run } = await request<{ run: RunView }>('POST', `/runs/${id}/${action}`)
  // Stop is a no-op on runs that already ended; don't imply a transition.
  if (action === 'stop' && run.status !== 'stopped') {
    console.log(`Loop ${run.id} had already ended (${run.status}); nothing to stop.`)
    return
  }
  console.log(`Loop ${run.id} is now ${run.status}.`)
}

async function extend(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { 'max-sessions': { type: 'string' } },
    allowPositionals: true,
  })
  const id = requireId(positionals)
  if (!values['max-sessions']) throw new Error(`--max-sessions is required\n\n${USAGE}`)
  const { run } = await request<{ run: RunView }>('POST', `/runs/${id}/extend`, {
    maxSessions: Number(values['max-sessions']),
  })
  console.log(
    `Loop ${run.id} limit raised to ${run.maxSessions} sessions (currently ${run.status}).`,
  )
  if (run.status !== 'running') {
    console.log(`Continue it with: npm run mission -- resume ${run.id}`)
  }
}

async function inbox(argv: string[]): Promise<void> {
  // No parseArgs here: everything after the id is the literal message, so
  // words that start with "-" must not be interpreted as options. A single
  // leading "--" is still treated as the conventional options terminator.
  const [idArg, ...messageParts] = argv
  const id = requireId(idArg === undefined ? [] : [idArg])
  const literalParts = messageParts[0] === '--' ? messageParts.slice(1) : messageParts
  const message = literalParts.join(' ').trim()
  if (!message) throw new Error(`a message is required\n\n${USAGE}`)
  const entry = await request<{ id: string }>('POST', `/runs/${id}/inbox`, { message })
  console.log(`Appended inbox entry ${entry.id} to loop ${id}.`)
}

async function request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error(
      `Global Runtime is not reachable at ${BASE_URL}. Start it with: npm run global-runtime`,
    )
  }
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON body; the status check below reports the failure.
  }
  if (!response.ok) {
    const error =
      parsed && typeof parsed === 'object' && 'error' in parsed ? String(parsed.error) : null
    throw new Error(error ?? `Global Runtime responded with HTTP ${response.status}`)
  }
  return parsed as T
}

// `npm run` executes scripts with cwd set to the package root, so resolving a
// relative --workspace against process.cwd() would silently point the loop at
// this repository instead of the directory the user typed the command in. npm
// preserves that directory in INIT_CWD.
function resolveFromInvocationDir(target: string): string {
  return path.resolve(process.env.INIT_CWD?.trim() || process.cwd(), target)
}

function requireId(positionals: string[]): number {
  const id = Number(positionals[0])
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`a run id is required\n\n${USAGE}`)
  return id
}

function printTable(rows: string[][]): void {
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length)),
  )
  for (const row of rows) {
    console.log(row.map((cell, column) => cell.padEnd(widths[column]!)).join('  '))
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(4)}`
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
