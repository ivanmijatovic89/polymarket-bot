import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { SESSION_RESULT_FILE } from './contracts.js'
import { RuntimeValidationError } from './errors.js'
import type { RuntimeFileView, RuntimeFilesResponse, RuntimeRun } from './types.js'

const MAX_FILE_BYTES = 256 * 1024
const JOURNAL_TAIL_BYTES = 64 * 1024

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function existingAncestor(candidate: string): Promise<string> {
  let current = candidate
  for (;;) {
    try {
      await stat(current)
      return current
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

export async function canonicalWorkspace(workspacePath: string): Promise<string> {
  try {
    const resolved = await realpath(path.resolve(workspacePath))
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new RuntimeValidationError('workspace path must be a directory')
    return resolved
  } catch (error) {
    if (error instanceof RuntimeValidationError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') {
      throw new RuntimeValidationError('workspace path must be an accessible directory')
    }
    throw error
  }
}

export async function resolveWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  allowMissing: boolean,
): Promise<string> {
  const root = await canonicalWorkspace(workspacePath)
  const candidate = path.resolve(root, relativePath)
  if (!isInside(root, candidate)) {
    throw new RuntimeValidationError(`${relativePath} escapes the configured workspace`)
  }

  try {
    const resolved = await realpath(candidate)
    if (!isInside(root, resolved)) {
      throw new RuntimeValidationError(`${relativePath} resolves outside the configured workspace`)
    }
    return resolved
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !allowMissing) throw error
    const ancestor = await realpath(await existingAncestor(path.dirname(candidate)))
    if (!isInside(root, ancestor)) {
      throw new RuntimeValidationError(`${relativePath} has a parent outside the workspace`)
    }
    return candidate
  }
}

export async function validateRunWorkspace(run: RuntimeRun): Promise<void> {
  const canonical = await canonicalWorkspace(run.workspacePath)
  if (canonical !== run.workspacePath) {
    throw new RuntimeValidationError('workspace path must be stored in canonical form')
  }
  try {
    const mission = await resolveWorkspaceFile(run.workspacePath, run.missionPath, false)
    const info = await stat(mission)
    if (!info.isFile()) throw new RuntimeValidationError('mission path must be a readable file')
  } catch (error) {
    if (error instanceof RuntimeValidationError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') {
      throw new RuntimeValidationError('mission path must be an accessible file')
    }
    throw error
  }

  await Promise.all([
    resolveWorkspaceFile(run.workspacePath, run.statusFile, true),
    resolveWorkspaceFile(run.workspacePath, run.journalFile, true),
    resolveWorkspaceFile(run.workspacePath, run.inboxFile, true),
    ...run.readOnlyFiles.map((file) => resolveWorkspaceFile(run.workspacePath, file, true)),
  ])
}

async function readWorkspaceFile(
  run: RuntimeRun,
  role: RuntimeFileView['role'],
  relativePath: string,
): Promise<RuntimeFileView> {
  const absolutePath = await resolveWorkspaceFile(run.workspacePath, relativePath, true)
  try {
    const info = await stat(absolutePath)
    if (!info.isFile()) throw new RuntimeValidationError(`${relativePath} is not a file`)
    const limit = role === 'journal' ? JOURNAL_TAIL_BYTES : MAX_FILE_BYTES
    const truncated = info.size > limit
    const visible = await readTail(absolutePath, info.size, limit)
    return {
      role,
      path: relativePath,
      exists: true,
      content: visible.toString('utf8'),
      truncated,
      modifiedAt: info.mtime.toISOString(),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return {
      role,
      path: relativePath,
      exists: false,
      content: '',
      truncated: false,
      modifiedAt: null,
    }
  }
}

export async function readRuntimeFiles(run: RuntimeRun): Promise<RuntimeFilesResponse> {
  const files = await Promise.all([
    readWorkspaceFile(run, 'status', run.statusFile),
    readWorkspaceFile(run, 'journal', run.journalFile),
    readWorkspaceFile(run, 'inbox', run.inboxFile),
    ...run.readOnlyFiles.map((file) => readWorkspaceFile(run, 'read_only', file)),
  ])
  return { files }
}

export async function appendInboxEntry(
  run: RuntimeRun,
  message: string,
): Promise<{ id: string; appendedAt: string }> {
  const absolutePath = await resolveWorkspaceFile(run.workspacePath, run.inboxFile, true)
  const parent = path.dirname(absolutePath)
  await mkdir(parent, { recursive: true })
  const resolvedParent = await realpath(parent)
  const root = await canonicalWorkspace(run.workspacePath)
  if (!isInside(root, resolvedParent)) {
    throw new RuntimeValidationError('inbox parent resolves outside the workspace')
  }

  const appendedAt = new Date().toISOString()
  const id = `${appendedAt}-${randomUUID().slice(0, 8)}`
  const entry = `\n## ${id}\n\n${message.trim()}\n`
  const handle = await open(absolutePath, 'a', 0o600)
  try {
    await handle.writeFile(entry, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  return { id, appendedAt }
}

export async function prepareSessionResultFile(run: RuntimeRun): Promise<void> {
  const root = await canonicalWorkspace(run.workspacePath)
  const absolutePath = path.resolve(root, SESSION_RESULT_FILE)
  if (!isInside(root, absolutePath)) {
    throw new RuntimeValidationError('session result path escapes the workspace')
  }
  await resolveWorkspaceFile(run.workspacePath, path.dirname(SESSION_RESULT_FILE), true)
  const parent = path.dirname(absolutePath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const resolvedParent = await realpath(parent)
  if (!isInside(root, resolvedParent)) {
    throw new RuntimeValidationError('session result parent resolves outside the workspace')
  }
  try {
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new RuntimeValidationError('session result path must be a regular file')
    }
    await unlink(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function readSessionResultFile(run: RuntimeRun): Promise<unknown> {
  const candidate = path.resolve(run.workspacePath, SESSION_RESULT_FILE)
  const candidateInfo = await lstat(candidate)
  if (candidateInfo.isSymbolicLink()) {
    throw new RuntimeValidationError('session result path must not be a symbolic link')
  }
  const absolutePath = await resolveWorkspaceFile(run.workspacePath, SESSION_RESULT_FILE, false)
  const info = await stat(absolutePath)
  if (!info.isFile() || info.size > 16 * 1024) {
    throw new RuntimeValidationError('session result must be a JSON file smaller than 16 KB')
  }
  return JSON.parse(await readFile(absolutePath, 'utf8')) as unknown
}

async function readTail(filePath: string, size: number, limit: number): Promise<Buffer> {
  const length = Math.min(size, limit)
  const buffer = Buffer.alloc(length)
  const handle = await open(filePath, 'r')
  try {
    await handle.read(buffer, 0, length, Math.max(0, size - length))
    return buffer
  } finally {
    await handle.close()
  }
}
