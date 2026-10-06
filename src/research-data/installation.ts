import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite, readJson, writeJson } from './files.js'
import { claimLock } from './sync.js'
import { readUpdateConfig, type UpdateConfig } from './update.js'

/** Build and validate a candidate without changing the installed configuration. */
export async function prepareUpdateConfig(
  runtime: string,
  options: Pick<UpdateConfig, 'root' | 'from' | 'market'>,
): Promise<string> {
  const previous = await readJson<UpdateConfig>(path.join(options.root, 'update-config.json'))
  const candidate = path.join(runtime, 'update-config.json')
  await writeJson(candidate, {
    version: 1,
    ...options,
    concurrency: previous?.concurrency ?? 16,
    requestsPerSecond: previous?.requestsPerSecond ?? 60,
    minFreeGiB: previous?.minFreeGiB ?? 5,
  })
  await readUpdateConfig(candidate)
  return candidate
}

const readOptional = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Publish a tested release; handled activation failures restore all installed files. */
export async function activateResearchSchedule(options: {
  root: string
  candidateConfig: string
  plistPath: string
  plist: string
  metadata: unknown
  stop: () => void
  start: () => void
}): Promise<void> {
  const config = await readUpdateConfig(options.candidateConfig)
  if (config.root !== options.root) throw new Error('Candidate configuration root mismatch')
  const releaseInstallation = await claimLock(path.join(options.root, 'runtime', 'installation'))
  let release: (() => Promise<void>) | undefined
  let stopped = false
  try {
    release = await claimLock(options.root)
    const files = [
      {
        file: path.join(options.root, 'update-config.json'),
        value: JSON.stringify(config, null, 2) + '\n',
      },
      { file: options.plistPath, value: options.plist },
      {
        file: path.join(options.root, 'schedule.json'),
        value: JSON.stringify(options.metadata, null, 2) + '\n',
      },
    ]
    const previous = await Promise.all(files.map(({ file }) => readOptional(file)))
    try {
      // Keep the writer lock until the old job is unloaded and all files are published.
      options.stop()
      stopped = true
      for (const { file, value } of files) await atomicWrite(file, value)
      // RunAtLoad must be able to acquire the writer lock immediately.
      await release()
      options.start()
    } catch (error) {
      if (stopped) {
        try {
          options.stop()
          for (let i = 0; i < files.length; i++) {
            if (previous[i] === null) await rm(files[i]!.file, { force: true })
            else await atomicWrite(files[i]!.file, previous[i]!)
          }
          await release()
          if (previous[1] !== null) options.start()
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Schedule activation and rollback failed; inspect installed configuration and launchd job',
          )
        }
      }
      throw error
    }
  } finally {
    try {
      await release?.()
    } finally {
      await releaseInstallation()
    }
  }
}
