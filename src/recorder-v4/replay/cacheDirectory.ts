import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** Call after the entry point loads its environment; prefetch and replay share this path. */
export function recorderReplayCacheDirectory(): string {
  return path.resolve(REPO_ROOT, process.env.RECORDER_REPLAY_CACHE_DIR ?? 'data/recorder-v4-cache')
}
