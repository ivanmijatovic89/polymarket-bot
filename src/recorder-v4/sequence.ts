import { randomUUID } from 'node:crypto'
import { link, open, readFile, readdir, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'

import { atomicWrite, ensureDirectory, exists, isMissing, syncDirectory } from './storage/files.js'
import type { CapturedEvent, RawFrame } from './types.js'

const LEASE_SIZE = 1_000_000_000_000n
const MAX_INT64 = 9_223_372_036_854_775_807n

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

type LockClaim = { pid: number; sessionId: string; hostname: string }

/**
 * Immutable, exclusively linked claims give contenders a total order. Never unlink a stale
 * claim: read/unlink/recreate can accidentally remove a concurrent restarter's live lock.
 * A crashed owner is ignored by later claims; completed owners have durable release markers.
 */
async function claimSpool(spoolDir: string, sessionId: string): Promise<() => Promise<void>> {
  const directory = path.join(spoolDir, 'recorder-locks')
  await ensureDirectory(directory)
  await syncDirectory(spoolDir)
  const names = (await readdir(directory)).filter((name) => /^\d{20}\.json$/.test(name)).sort()
  let generation = names.length ? BigInt(names.at(-1)!.slice(0, 20)) + 1n : 1n
  const candidate = path.join(directory, `candidate-${sessionId}.tmp`)
  const handle = await open(candidate, 'wx', 0o600)
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, sessionId, hostname: hostname() } satisfies LockClaim),
    )
    await handle.sync()
  } finally {
    await handle.close()
  }
  let claimPath: string
  while (true) {
    if (generation > MAX_INT64) throw new Error('[recorder] lock generation exhausted')
    claimPath = path.join(directory, `${generation.toString().padStart(20, '0')}.json`)
    try {
      await link(candidate, claimPath)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      generation++
    }
  }
  await unlink(candidate)
  await syncDirectory(directory)
  let released = false
  const release = async () => {
    if (released) return
    await atomicWrite(
      `${claimPath}.released`,
      JSON.stringify({ sessionId, releasedAtMs: Date.now() }),
    )
    released = true
  }
  try {
    for (const name of await readdir(directory)) {
      if (!/^\d{20}\.json$/.test(name) || BigInt(name.slice(0, 20)) >= generation) continue
      const file = path.join(directory, name)
      if (await exists(`${file}.released`)) continue
      const claim = JSON.parse(await readFile(file, 'utf8')) as LockClaim
      if (!Number.isSafeInteger(claim.pid) || claim.pid <= 0 || typeof claim.hostname !== 'string')
        throw new Error('[recorder] corrupt spool lock claim; inspect recorder-locks')
      if (claim.hostname !== hostname() || processExists(claim.pid))
        throw new Error('[recorder] spool is locked by another process; inspect recorder-locks')
      // Retire a known-dead owner so an unrelated process reusing its PID cannot block a later boot.
      await atomicWrite(
        `${file}.released`,
        JSON.stringify({ sessionId: claim.sessionId, retiredAtMs: Date.now() }),
      )
    }
    return release
  } catch (error) {
    await release()
    throw error
  }
}

/** One process owns a local spool. Sequence leases survive SIGKILL without reuse. */
export async function openCaptureSequence(spoolDir: string): Promise<{
  captureId: string
  sessionId: string
  capture: (frame: RawFrame, eventType?: string) => CapturedEvent
  close: () => Promise<void>
}> {
  await ensureDirectory(spoolDir)
  // V3 has an unversioned sequence file. Reject it before creating locks or reserving a lease.
  const priorSequence = path.join(spoolDir, 'sequence.json')
  if (await exists(priorSequence)) {
    const prior = JSON.parse(await readFile(priorSequence, 'utf8')) as { schemaVersion?: unknown }
    if (prior.schemaVersion !== 4)
      throw new Error('[recorder] invalid sequence state: use a separate V4 spool')
  }
  const sessionId = randomUUID()
  const release = await claimSpool(spoolDir, sessionId)
  try {
    const sequencePath = path.join(spoolDir, 'sequence.json')
    let state: { captureId: string; nextLease: string }
    try {
      state = JSON.parse(await readFile(sequencePath, 'utf8')) as typeof state
      if (
        typeof state.captureId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(state.captureId) ||
        !/^\d+$/.test(state.nextLease) ||
        BigInt(state.nextLease) < 1n
      ) {
        throw new Error('[recorder] invalid sequence state; refusing to reuse event IDs')
      }
    } catch (error) {
      if (!isMissing(error)) throw error
      const entries = await readdir(spoolDir, { withFileTypes: true })
      if (entries.some((entry) => entry.isDirectory() && entry.name !== 'recorder-locks'))
        throw new Error(
          '[recorder] sequence state missing from an existing spool; refusing to reset event ordering',
        )
      state = { captureId: randomUUID(), nextLease: '1' }
    }
    let next = BigInt(state.nextLease)
    const end = next + LEASE_SIZE
    if (end > MAX_INT64) throw new Error('[recorder] sequence range exhausted')
    await atomicWrite(
      sequencePath,
      JSON.stringify({ schemaVersion: 4, captureId: state.captureId, nextLease: end.toString() }),
    )
    let closed = false
    return {
      captureId: state.captureId,
      sessionId,
      capture(frame, eventType = 'message') {
        if (closed || next >= end) throw new Error('[recorder] capture sequence unavailable')
        if (
          !Number.isSafeInteger(frame.stamp.receivedAtMs) ||
          frame.stamp.receivedAtMs < 0 ||
          !/^\d+$/.test(frame.stamp.monotonicNs) ||
          BigInt(frame.stamp.monotonicNs) > MAX_INT64
        )
          throw new Error('[recorder] invalid capture timestamp')
        const sequence = (next++).toString()
        return {
          schemaVersion: 4,
          captureId: state.captureId,
          sessionId,
          sequence,
          eventId: `${state.captureId}:${sequence}`,
          receivedAtMs: frame.stamp.receivedAtMs,
          monotonicNs: frame.stamp.monotonicNs,
          source: frame.source,
          connectionId: frame.connectionId,
          eventType,
          sourceTimeMs: null,
          rawJson: frame.rawJson,
          detailsJson: frame.request ? JSON.stringify(frame.request) : null,
        }
      },
      async close() {
        if (closed) return
        closed = true
        await release()
      },
    }
  } catch (error) {
    await release()
    throw error
  }
}
