import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants, type BigIntStats } from 'node:fs'
import { lstat, mkdir, open, realpath, stat, unlink, type FileHandle } from 'node:fs/promises'
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

async function canonicalizePotentialPath(root: string, candidate: string): Promise<string> {
  const segments = path.relative(root, candidate).split(path.sep).filter(Boolean)
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    const next = path.join(current, segments[index]!)
    try {
      current = await realpath(next)
      if (!isInside(root, current)) {
        throw new RuntimeValidationError('configured path resolves outside the workspace')
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      try {
        const info = await lstat(next)
        if (info.isSymbolicLink()) {
          throw new RuntimeValidationError('configured path must not be a symbolic link')
        }
      } catch (lstatError) {
        if ((lstatError as NodeJS.ErrnoException).code !== 'ENOENT') throw lstatError
      }
      return path.resolve(current, ...segments.slice(index))
    }
  }
  return current
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
    return canonicalizePotentialPath(root, candidate)
  }
}

export async function validateRunWorkspace(run: RuntimeRun): Promise<void> {
  const canonical = await canonicalWorkspace(run.workspacePath)
  if (canonical !== run.workspacePath) {
    throw new RuntimeValidationError('workspace path must be stored in canonical form')
  }
  const configuredFiles = [
    { role: 'mission', relativePath: run.missionPath, allowMissing: false },
    { role: 'status', relativePath: run.statusFile, allowMissing: true },
    { role: 'journal', relativePath: run.journalFile, allowMissing: true },
    { role: 'inbox', relativePath: run.inboxFile, allowMissing: true },
    ...run.readOnlyFiles.map((relativePath, index) => ({
      role: `read-only file ${index + 1}`,
      relativePath,
      allowMissing: true,
    })),
  ]
  let resolvedFiles: Array<(typeof configuredFiles)[number] & { absolutePath: string }>
  try {
    resolvedFiles = await Promise.all(
      configuredFiles.map(async (file) => ({
        ...file,
        absolutePath: await resolveWorkspaceFile(
          run.workspacePath,
          file.relativePath,
          file.allowMissing,
        ),
      })),
    )
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES') {
      throw new RuntimeValidationError('configured runtime file paths must be accessible')
    }
    throw error
  }
  let reservedResultPath: string
  try {
    reservedResultPath = await resolveWorkspaceFile(run.workspacePath, SESSION_RESULT_FILE, true)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error
    reservedResultPath = path.resolve(run.workspacePath, SESSION_RESULT_FILE)
  }

  const seenPaths = new Map<string, string>()
  for (const file of resolvedFiles) {
    if (file.absolutePath === reservedResultPath) {
      throw new RuntimeValidationError(
        `${file.role} path must not use the reserved ${SESSION_RESULT_FILE} path`,
      )
    }
    const previousRole = seenPaths.get(file.absolutePath)
    if (previousRole) {
      throw new RuntimeValidationError(`${file.role} path overlaps the ${previousRole} path`)
    }
    seenPaths.set(file.absolutePath, file.role)

    try {
      const info = await stat(file.absolutePath, { bigint: true })
      if (info.isFile() && info.nlink !== 1n) {
        throw new RuntimeValidationError(`${file.role} path must not be hard-linked`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !file.allowMissing) throw error
    }
  }

  try {
    const mission = resolvedFiles[0]!.absolutePath
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
}

async function readWorkspaceFile(
  run: RuntimeRun,
  role: RuntimeFileView['role'],
  relativePath: string,
): Promise<RuntimeFileView> {
  const opened = await openVerifiedWorkspaceFile(run, relativePath, true)
  if (opened) {
    const limit = role === 'journal' ? JOURNAL_TAIL_BYTES : MAX_FILE_BYTES
    try {
      const size = safeFileSize(opened.info.size, relativePath)
      const truncated = size > limit
      const visible = await readTail(opened.handle, size, limit)
      return {
        role,
        path: relativePath,
        exists: true,
        content: visible.toString('utf8'),
        truncated,
        modifiedAt: opened.info.mtime.toISOString(),
      }
    } finally {
      await opened.handle.close()
    }
  }
  return {
    role,
    path: relativePath,
    exists: false,
    content: '',
    truncated: false,
    modifiedAt: null,
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
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_APPEND |
    fsConstants.O_CREAT |
    (fsConstants.O_NOFOLLOW ?? 0)
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(absolutePath, flags, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new RuntimeValidationError('inbox path must not be a symbolic link')
    }
    throw error
  }
  try {
    const openedInfo = await handle.stat({ bigint: true })
    if (!openedInfo.isFile()) {
      throw new RuntimeValidationError('inbox path must be a regular file')
    }
    if (openedInfo.nlink !== 1n) {
      throw new RuntimeValidationError('inbox path must not be hard-linked')
    }
    const resolvedPath = await realpath(absolutePath)
    if (!isInside(root, resolvedPath)) {
      throw new RuntimeValidationError('inbox path resolves outside the workspace')
    }
    const resolvedInfo = await stat(resolvedPath, { bigint: true })
    if (openedInfo.dev !== resolvedInfo.dev || openedInfo.ino !== resolvedInfo.ino) {
      throw new RuntimeValidationError('inbox path changed while it was being opened')
    }
    if (resolvedInfo.nlink !== 1n) {
      throw new RuntimeValidationError('inbox path must not be hard-linked')
    }
    await handle.writeFile(entry, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  return { id, appendedAt }
}

export async function computeMissionHash(run: RuntimeRun): Promise<string | null> {
  try {
    const opened = await openVerifiedWorkspaceFile(run, run.missionPath, false)
    if (!opened) return null
    try {
      return createHash('sha256')
        .update(await opened.handle.readFile())
        .digest('hex')
    } finally {
      await opened.handle.close()
    }
  } catch {
    // The mission file is validated at launch; a transient read failure here
    // only loses the provenance hash, never the session.
    return null
  }
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
  const opened = await openVerifiedWorkspaceFile(run, SESSION_RESULT_FILE, false)
  if (!opened) throw new RuntimeValidationError('session result file does not exist')
  try {
    if (opened.info.size > BigInt(16 * 1024)) {
      throw new RuntimeValidationError('session result must be a JSON file smaller than 16 KB')
    }
    return JSON.parse(await opened.handle.readFile('utf8')) as unknown
  } finally {
    await opened.handle.close()
  }
}

async function openVerifiedWorkspaceFile(
  run: RuntimeRun,
  relativePath: string,
  allowMissing: boolean,
): Promise<{
  handle: FileHandle
  info: BigIntStats
} | null> {
  const root = await canonicalWorkspace(run.workspacePath)
  const absolutePath = await resolveWorkspaceFile(run.workspacePath, relativePath, allowMissing)
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(absolutePath, flags)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' && allowMissing) return null
    if (code === 'ELOOP') {
      throw new RuntimeValidationError(`${relativePath} must not be a symbolic link`)
    }
    throw error
  }

  try {
    const openedInfo = await handle.stat({ bigint: true })
    if (!openedInfo.isFile()) throw new RuntimeValidationError(`${relativePath} is not a file`)
    if (openedInfo.nlink !== 1n) {
      throw new RuntimeValidationError(`${relativePath} must not be hard-linked`)
    }
    const resolvedPath = await realpath(absolutePath)
    if (!isInside(root, resolvedPath)) {
      throw new RuntimeValidationError(`${relativePath} resolves outside the workspace`)
    }
    const resolvedInfo = await stat(resolvedPath, { bigint: true })
    if (openedInfo.dev !== resolvedInfo.dev || openedInfo.ino !== resolvedInfo.ino) {
      throw new RuntimeValidationError(`${relativePath} changed while it was being opened`)
    }
    return { handle, info: openedInfo }
  } catch (error) {
    await handle.close()
    throw error
  }
}

function safeFileSize(size: bigint, relativePath: string): number {
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RuntimeValidationError(`${relativePath} is too large to display safely`)
  }
  return Number(size)
}

async function readTail(handle: FileHandle, size: number, limit: number): Promise<Buffer> {
  const length = Math.min(size, limit)
  const buffer = Buffer.alloc(length)
  const start = Math.max(0, size - length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return offset === length ? buffer : buffer.subarray(0, offset)
}
