/**
 * Engine identity embedded into every binary (31 §5.3):
 * PMB_ENGINE_SOURCE_HASH, PMB_ENGINE_COMMIT, PMB_ENGINE_DIRTY.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runOk } from './host.js'
import {
  ENGINE_SOURCE_PATHSPECS,
  computeEngineSourceHash,
  isEngineSourcePath,
  sha256Hex,
} from './sourceHash.js'

export type EngineIdentity = {
  sourceHash: string
  commit: string
  dirty: boolean
  /** Number of files in the engine source set (provenance). */
  fileCount: number
}

/**
 * Re-include native/build/ for git's untracked-file listing: the root
 * .gitignore's `build/` rule would otherwise hide untracked files there,
 * while 31 §5.3 lists native/build/** in the engine source set. Other rules
 * (e.g. `.DS_Store`) still apply, so editor and Finder litter never enters
 * the hash. Command-line excludes take precedence over .gitignore files.
 */
const REINCLUDE_BUILD = ['-x', '!native/build/'] as const

/**
 * Compute the engine identity of the checkout at `engineRoot` (31 §5.3).
 * Working-tree contents are hashed: tracked files and untracked files that
 * git does not ignore (with native/build/ re-included).
 */
export function computeEngineIdentity(engineRoot: string, env: NodeJS.ProcessEnv): EngineIdentity {
  const git = (args: string[]): string =>
    runOk('git', ['-C', engineRoot, ...args], { cwd: engineRoot, env })
  const nul = (out: string): string[] => out.split('\0').filter((p) => p !== '')
  const listed = nul(
    git(['ls-files', '-z', '-c', '-o', '--exclude-standard', ...REINCLUDE_BUILD, '--', 'native']),
  )
  const set = new Set<string>()
  for (const rel of listed) {
    if (!isEngineSourcePath(rel)) continue
    const abs = path.join(engineRoot, rel)
    // Tracked but deleted in the working tree: not part of the working-tree contents.
    if (!existsSync(abs)) continue
    const st = lstatSync(abs)
    if (st.isSymbolicLink()) throw new Error(`symlink in the engine source set: ${rel}`)
    if (!st.isFile()) continue
    set.add(rel)
  }
  if (!set.has('native/Cargo.toml') || !set.has('native/build/artifact-build.toml')) {
    throw new Error(
      `${engineRoot} is not an engine checkout (native/Cargo.toml or native/build/artifact-build.toml missing)`,
    )
  }
  const entries: Array<[string, string]> = [...set].map((rel) => [
    rel,
    sha256Hex(readFileSync(path.join(engineRoot, rel))),
  ])
  const sourceHash = computeEngineSourceHash(entries)

  const commit = git(['log', '-1', '--format=%H', '--', ...ENGINE_SOURCE_PATHSPECS]).trim()
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(`cannot determine the engine commit in ${engineRoot}`)
  const status = git([
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    ...ENGINE_SOURCE_PATHSPECS,
  ]).trim()
  // Untracked files under native/build/ that `git status` hides behind `build/`.
  const untrackedBuild = nul(
    git(['ls-files', '-z', '-o', '--exclude-standard', ...REINCLUDE_BUILD, '--', 'native/build']),
  ).filter((rel) => isEngineSourcePath(rel))
  return {
    sourceHash,
    commit,
    dirty: status !== '' || untrackedBuild.length > 0,
    fileCount: entries.length,
  }
}
