import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { SimulatorStatus, TraceManifest } from '@bot/backtest/simulator/contracts'

function repositoryRoot(): string {
  let dir = process.cwd()
  while (!existsSync(path.join(dir, 'src/cli/backtest-simulator.ts'))) {
    const parent = path.dirname(dir)
    if (parent === dir)
      throw new Error('Simulator requires the repository source on the dashboard host.')
    dir = parent
  }
  return dir
}
const root = repositoryRoot()
const cache = path.join(root, 'data/simulator-sessions')
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
type Job = { state: SimulatorStatus; child?: ChildProcess; timeout?: NodeJS.Timeout }
type Manager = { jobs: Map<string, Job>; active: string | null }
const host = globalThis as typeof globalThis & { __simulatorJobs?: Manager }
const manager = (host.__simulatorJobs ??= { jobs: new Map(), active: null })

export function simulatorDirectory(id: string): string {
  if (!idPattern.test(id)) throw new Error('Invalid simulator session id')
  return path.join(cache, id)
}
function save(job: Job): void {
  const file = path.join(simulatorDirectory(job.state.id), 'status.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(job.state))
  renameSync(`${file}.tmp`, file)
}
function prune(): void {
  mkdirSync(cache, { recursive: true })
  const completed = readdirSync(cache)
    .filter((id) => idPattern.test(id))
    .filter((id) => !['queued', 'running'].includes(manager.jobs.get(id)?.state.status ?? ''))
    .map((id) => {
      const dir = simulatorDirectory(id)
      return {
        id,
        time: statSync(dir).mtimeMs,
        bytes: readdirSync(dir).reduce((sum, f) => sum + statSync(path.join(dir, f)).size, 0),
      }
    })
    .sort((a, b) => b.time - a.time)
  let bytes = 0
  completed.forEach((entry, i) => {
    bytes += entry.bytes
    if (i >= 9 || bytes > 2 * 1024 ** 3 || Date.now() - entry.time > 24 * 3600_000) {
      rmSync(simulatorDirectory(entry.id), { recursive: true, force: true })
      manager.jobs.delete(entry.id)
    }
  })
}
function pump(): void {
  if (manager.active) return
  const job = [...manager.jobs.values()].find((j) => j.state.status === 'queued')
  if (!job) return
  manager.active = job.state.id
  job.state.status = 'running'
  job.state.message = 'Resolving strategy and historical data…'
  save(job)
  try {
    // Spawn the repository source as a runtime argument. Turbopack traces fork's
    // module argument as a bundle entry, but this worker intentionally runs outside Next.
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(root, 'src/cli/backtest-simulator.ts'),
        String(job.state.runId),
        job.state.slug,
        simulatorDirectory(job.state.id),
      ],
      {
        cwd: root,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    )
    job.child = child
    let ready = false
    child.on('message', (message: unknown) => {
      if (job.state.status !== 'running' || !message || typeof message !== 'object') return
      const msg = message as { type?: string; ticks?: number; message?: string }
      if (typeof msg.ticks === 'number' && Number.isFinite(msg.ticks)) job.state.ticks = msg.ticks
      if (msg.type === 'progress')
        job.state.message = `Capturing ${job.state.ticks.toLocaleString()} ticks…`
      if (msg.type === 'ready') ready = true
      if (msg.type === 'failed') {
        job.state.status = 'failed'
        job.state.message = String(msg.message ?? 'Replay failed').slice(0, 4000)
      }
      save(job)
    })
    child.on('error', (error) => {
      job.state.status = 'failed'
      job.state.message = error.message
      save(job)
    })
    child.once('close', (code) => {
      clearTimeout(job.timeout)
      if (job.state.status === 'running') {
        job.state.status = ready && code === 0 ? 'ready' : 'failed'
        job.state.message =
          job.state.status === 'ready'
            ? 'Replay ready'
            : `Replay process exited (${code ?? 'signal'}).`
        save(job)
      }
      delete job.child
      manager.active = null
      pump()
    })
    job.timeout = setTimeout(() => {
      if (job.state.status === 'running') {
        job.state.status = 'failed'
        job.state.message = 'Replay exceeded the five-minute preparation limit.'
        save(job)
      }
      terminate(child)
    }, 300_000)
    job.timeout.unref()
  } catch (error) {
    job.state.status = 'failed'
    job.state.message = error instanceof Error ? error.message : 'Could not start simulator'
    save(job)
    manager.active = null
    pump()
  }
}
function terminate(child: ChildProcess): void {
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 5000)
  timer.unref()
  child.once('exit', () => clearTimeout(timer))
}

export function startSimulator(runId: number, slug: string): SimulatorStatus {
  if (!Number.isSafeInteger(runId) || runId < 1 || !/^[a-zA-Z0-9_-]{1,255}$/.test(slug))
    throw new Error('Invalid run or market identifier')
  const pending = [...manager.jobs.values()].filter((j) =>
    ['running', 'queued'].includes(j.state.status),
  )
  const duplicate = pending.find((j) => j.state.runId === runId && j.state.slug === slug)
  if (duplicate) return { ...duplicate.state }
  if (pending.length >= 6) throw new Error('Simulator queue is full. Wait for a replay to finish.')
  prune()
  const state: SimulatorStatus = {
    id: randomUUID(),
    runId,
    slug,
    status: 'queued',
    ticks: 0,
    message: 'Waiting for the current replay…',
    createdAt: Date.now(),
  }
  const job = { state }
  mkdirSync(simulatorDirectory(state.id), { recursive: true })
  manager.jobs.set(state.id, job)
  save(job)
  pump()
  return { ...state }
}
export function readSimulator(id: string): SimulatorStatus | null {
  const dir = simulatorDirectory(id)
  const job = manager.jobs.get(id)
  if (job) return { ...job.state }
  if (!existsSync(path.join(dir, 'status.json'))) return null
  const state = JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')) as SimulatorStatus
  if (state.status === 'running' || state.status === 'queued') {
    state.status = 'failed'
    state.message = 'Dashboard restarted during preparation. Start a new replay.'
  }
  return state
}
export function readSimulatorManifest(id: string): TraceManifest {
  if (readSimulator(id)?.status !== 'ready') throw new Error('Replay is not ready')
  return JSON.parse(
    readFileSync(path.join(simulatorDirectory(id), 'manifest.json'), 'utf8'),
  ) as TraceManifest
}
export function readSimulatorChunk(id: string, chunk: number): Buffer {
  if (!Number.isSafeInteger(chunk) || chunk < 0 || chunk >= 1000) throw new Error('Invalid chunk')
  if (readSimulator(id)?.status !== 'ready') throw new Error('Replay is not ready')
  return readFileSync(path.join(simulatorDirectory(id), `${chunk}.json.gz`))
}
export function cancelSimulator(id: string): SimulatorStatus | null {
  const state = readSimulator(id)
  if (!state) return null
  const job = manager.jobs.get(id)
  if (job && ['queued', 'running'].includes(job.state.status)) {
    job.state.status = 'canceled'
    job.state.message = 'Replay canceled'
    save(job)
    if (job.child) terminate(job.child)
    else pump()
    return { ...job.state }
  }
  return state
}
