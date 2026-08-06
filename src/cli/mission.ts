import '../config/env.js'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { desc, eq } from 'drizzle-orm'
import { closeDb, getDb } from '../db/index.js'
import { runtimeRuns } from '../db/schema.js'
import {
  getMachineCatalogEntry,
  listRuntimeMachines,
  machineLabel,
  resolveRuntimeMachine,
} from '../machines/catalog.js'
import { getMachineId } from '../machines/identity.js'

interface RunView {
  id: number
  machineId: string
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

// Fallback for fresh-clone dev setups whose machines.json has NO runtimeUrl
// entries yet; with a configured catalog, targets always come from it.
const FALLBACK_URL = (process.env.GLOBAL_RUNTIME_URL?.trim() || 'http://127.0.0.1:3053').replace(
  /\/+$/u,
  '',
)

const USAGE = `Mission CLI — thin client for Global Runtime daemons (issue #213: one per machine)

Usage:
  npm run mission -- create --name <name> --provider claude|codex --model <model> \\
      --workspace <path> --max-sessions <n> [--machine <name|id>] [--mission MISSION.md] \\
      [--effort low|medium|high|xhigh|max|ultracode|ultra] [--access workspace-write|full-access] \\
      [--auth-home <dir>] [--sandbox-settings <path>] [--delay <seconds>] [--isolated] \\
      [--read-only <path> ...] \\
      [--status-file <path>] [--journal-file <path>] [--inbox-file <path>] [--start]
  npm run mission -- list [--json]
  npm run mission -- show <id> [--json]
  npm run mission -- start|pause|resume|stop <id>
  npm run mission -- extend <id> --max-sessions <n>
  npm run mission -- inbox <id> <message>

create targets --machine (default: this machine, when it has a runtimeUrl in
machines.json). Per-run commands find the owning machine in the database and
talk to its daemon over the tailnet; set GLOBAL_RUNTIME_TOKEN when daemons
require bearer auth. list reads the shared database directly.`

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
      machine: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      access: { type: 'string' },
      'auth-home': { type: 'string' },
      'sandbox-settings': { type: 'string' },
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

  const target = createTarget(values.machine)
  const { run } = await request<{ run: RunView }>(target.url, 'POST', '/runs', {
    name: values.name,
    provider: values.provider,
    model: values.model,
    ...(values.effort ? { effort: values.effort } : {}),
    ...(values.access ? { accessMode: values.access } : {}),
    authHome: values['auth-home'] ?? null,
    ...(values['sandbox-settings']
      ? { sandboxSettingsPath: resolveFromInvocationDir(values['sandbox-settings']) }
      : {}),
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
  console.log(`Created loop ${run.id} (${run.status}) on ${target.label}: ${run.name}`)
  console.log(`  workspace: ${run.workspacePath}`)
  console.log(`  mission:   ${run.missionPath}`)
  console.log(`  state:     ${run.statusFile} · ${run.journalFile} · ${run.inboxFile}`)
  if (values.start) {
    const started = await request<{ run: RunView }>(target.url, 'POST', `/runs/${run.id}/start`)
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
  // List reads the shared database directly: it must show runs from EVERY
  // machine, including ones whose daemon is currently offline.
  const runs = await getDb()
    .select({
      id: runtimeRuns.id,
      machineId: runtimeRuns.machineId,
      status: runtimeRuns.status,
      provider: runtimeRuns.provider,
      model: runtimeRuns.model,
      currentSession: runtimeRuns.currentSession,
      maxSessions: runtimeRuns.maxSessions,
      name: runtimeRuns.name,
      updatedAt: runtimeRuns.updatedAt,
    })
    .from(runtimeRuns)
    .orderBy(desc(runtimeRuns.updatedAt))
  if (values.json) {
    console.log(JSON.stringify(runs, null, 2))
    return
  }
  if (runs.length === 0) {
    console.log('No loops yet. Create one with: npm run mission -- create …')
    return
  }
  const header = ['id', 'status', 'machine', 'provider', 'model', 'sessions', 'name']
  const rows = runs.map((run) => [
    String(run.id),
    run.status,
    machineLabel(run.machineId),
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
  const id = requireId(positionals)
  const owner = await ownerTarget(id)
  const detail = await request<DetailView>(owner.url, 'GET', `/runs/${id}`)
  if (values.json) {
    console.log(JSON.stringify(detail, null, 2))
    return
  }
  const { run, sessions, totals } = detail
  console.log(`Loop ${run.id}: ${run.name}`)
  console.log(`  machine:   ${owner.label}`)
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
  const owner = await ownerTarget(id)
  const { run } = await request<{ run: RunView }>(owner.url, 'POST', `/runs/${id}/${action}`)
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
  const owner = await ownerTarget(id)
  const { run } = await request<{ run: RunView }>(owner.url, 'POST', `/runs/${id}/extend`, {
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
  const owner = await ownerTarget(id)
  const entry = await request<{ id: string }>(owner.url, 'POST', `/runs/${id}/inbox`, { message })
  console.log(`Appended inbox entry ${entry.id} to loop ${id}.`)
}

type DaemonTarget = { url: string; label: string }

/** Target for `create`: --machine when given, else this machine's own daemon. */
function createTarget(machineArg: string | undefined): DaemonTarget {
  if (machineArg) {
    const resolved = resolveRuntimeMachine(machineArg)
    return {
      url: resolved.runtimeUrl.replace(/\/+$/u, ''),
      label: `${resolved.name} (${resolved.machineId})`,
    }
  }
  const machines = listRuntimeMachines()
  if (machines.length === 0) return { url: FALLBACK_URL, label: FALLBACK_URL }
  const localId = getMachineId()
  const local = machines.find(([machineId]) => machineId === localId)
  if (!local) {
    const options = machines.map(([machineId, entry]) => `${entry.name} (${machineId})`).join(', ')
    throw new Error(
      `this machine (${localId}) has no runtimeUrl in machines.json — pass --machine one of: ${options}`,
    )
  }
  return {
    url: (local[1].runtimeUrl as string).replace(/\/+$/u, ''),
    label: `${local[1].name} (${localId})`,
  }
}

/** Owning machine's daemon for an existing run, looked up in the shared database. */
async function ownerTarget(id: number): Promise<DaemonTarget> {
  // The DB lookup comes first even in the catalog-empty fallback case, so an
  // unknown run and a foreign-owned run get accurate errors rather than a
  // confusing 409 from whichever daemon the fallback URL points at.
  const [row] = await getDb()
    .select({ machineId: runtimeRuns.machineId })
    .from(runtimeRuns)
    .where(eq(runtimeRuns.id, id))
    .limit(1)
  if (!row) throw new Error(`run ${id} not found`)
  if (listRuntimeMachines().length === 0) return { url: FALLBACK_URL, label: FALLBACK_URL }
  const entry = getMachineCatalogEntry(row.machineId)
  if (!entry?.runtimeUrl) {
    throw new Error(
      `run ${id} belongs to ${machineLabel(row.machineId)} (${row.machineId}), which has no ` +
        'runtimeUrl configured in machines.json',
    )
  }
  return {
    url: entry.runtimeUrl.replace(/\/+$/u, ''),
    label: `${entry.name} (${row.machineId})`,
  }
}

function authHeaders(): Record<string, string> {
  const token = process.env.GLOBAL_RUNTIME_TOKEN?.trim()
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  baseUrl: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...authHeaders(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new Error(
      `Global Runtime is not reachable at ${baseUrl}. On its machine, start it with: npm run global-runtime`,
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
    if (response.status === 401) {
      throw new Error(
        `${error ?? 'unauthorized'} — set GLOBAL_RUNTIME_TOKEN in this shell/.env to the daemons' shared token`,
      )
    }
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

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(() => void closeDb().catch(() => undefined))
